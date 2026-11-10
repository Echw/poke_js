import groundDesktopUrl from '../assets/mist-replay/ground-desktop.bin?url';
import groundMobileUrl from '../assets/mist-replay/ground-mobile.bin?url';
import sourceHashes from 'virtual:smoke-source-hashes';
import { getPokeballHash } from '../scene/pokeballAsset';
import * as THREE from 'three';
import { GpuTimer } from './gpuTimer';
import { SMOKE_OPENING, SmokeBoundarySampler } from './smokeBoundary';
import { REPLAY_CONTRACT } from './smokeReplayTypes';
import { smokeProfile, type SmokeVariant } from './smokeProfile';
import desktopClipUrl from '../assets/mist-replay/ice-desktop.bin?url';
import mobileClipUrl from '../assets/mist-replay/ice-mobile.bin?url';
import fightingDesktopUrl from '../assets/mist-replay/fighting-desktop.bin?url';
import fightingMobileUrl from '../assets/mist-replay/fighting-mobile.bin?url';
import poisonDesktopUrl from '../assets/mist-replay/poison-desktop.bin?url';
import poisonMobileUrl from '../assets/mist-replay/poison-mobile.bin?url';
import type { ReplayProfile, SmokeReplayManifest } from './smokeReplayTypes';
import { SMOKE_DT, SMOKE_DURATION, SMOKE_FRAMES, smokeFrame } from './smokeTiming';
import { probeSmokeFiltering } from './smokeTextureProbe';
import { SmokeClipStore } from './smokeClipStore';
import { pruneSmokeCache } from './smokeClipCache';

export const smokeClipUrls = [desktopClipUrl, mobileClipUrl, fightingDesktopUrl, fightingMobileUrl,
    poisonDesktopUrl, poisonMobileUrl, groundDesktopUrl, groundMobileUrl];
export const cleanSmokeCache = () => pruneSmokeCache(smokeClipUrls);
const clipUrl = (variant: SmokeVariant, mobile: boolean) => variant === 'ground' ? (mobile ? groundMobileUrl : groundDesktopUrl)
    : variant === 'poison' ? (mobile ? poisonMobileUrl : poisonDesktopUrl)
    : variant === 'fighting' ? (mobile ? fightingMobileUrl : fightingDesktopUrl)
    : (mobile ? mobileClipUrl : desktopClipUrl);

/** Acquire compressed sources before GPU preparation; the store limits heavy downloads to two. */
export function prefetchSmokeClips(mobile: boolean): () => void {
    const releases = (['ice', 'fighting', 'poison', 'ground'] as SmokeVariant[]).map(variant => {
        const store = SmokeClipStore.acquire(clipUrl(variant, mobile));
        let released = false;
        const release = () => { if (!released) { released = true; store.release(); } };
        void store.ready.catch(release);
        return release;
    });
    return () => releases.forEach(release => release());
}

const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return { samples: sorted.length, median: sorted[Math.floor(sorted.length * 0.5)] ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0 };
};

/** Bounded atlas replay, restored to FP16 before upload. The host owns time and drawing. */
export class SmokeReplay {
    readonly densityResolution: number;
    readonly densityTiles: number;
    readonly domainMin = new THREE.Vector3(-1.7, -2.4, -1.7);
    readonly domainSize = 3.4;
    linearFiltering = false;
    readonly ready: Promise<void>;
    readonly timer: GpuTimer;
    readonly dt = SMOKE_DT;
    private targets: THREE.WebGLRenderTarget[] = [];
    private upload?: THREE.DataTexture;
    private active = 0;
    private frame = -1;
    private fieldVersion = 0;
    private manifest!: SmokeReplayManifest;
    private profile!: ReplayProfile;
    private store: SmokeClipStore;
    private disposed = false;
    private get chunks() { return this.store.chunks; }
    private prepareSerial = 0;
    private uploaded = 0;
    private downloadMs = 0;
    private uploadTimes: number[] = [];
    private decodedFrames = 0;
    private verifiedChunks = new Set<number>();
    private prefetchError?: Error;
    private renderer: THREE.WebGLRenderer;
    private boundary: SmokeBoundarySampler;
    private mobile: boolean;
    readonly variant: SmokeVariant;
    constructor(renderer: THREE.WebGLRenderer, boundary: SmokeBoundarySampler, mobile = false, variant: SmokeVariant = 'ice') {
        this.variant = variant;
        this.domainMin.fromArray(smokeProfile(variant).domainMin);
        this.renderer = renderer; this.boundary = boundary; this.mobile = mobile;
        this.densityResolution = mobile ? 96 : 128;
        this.densityTiles = Math.ceil(Math.sqrt(this.densityResolution));
        this.timer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
        this.store = SmokeClipStore.acquire(clipUrl(variant, mobile));
        this.ready = this.initialize();
    }
    get texture(): THREE.Texture { return this.targets[this.active]!.texture; }
    get version(): number { return this.fieldVersion; }
    get simulatedTime(): number { return Math.max(0, this.frame) * this.dt; }
    private index(time: number): number {
        return smokeFrame(time);
    }
    private async initialize(): Promise<void> {
        const started = performance.now();
        if (!('DecompressionStream' in globalThis)) throw new Error('Replay inflate unavailable');
        if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('Replay requires little-endian FP16 support');
        this.manifest = await this.store.ready;
        const m = this.manifest;
        const config = smokeProfile(this.variant);
        if (m.contract !== REPLAY_CONTRACT || m.dt !== this.dt || m.frames !== SMOKE_FRAMES || m.chunkFrames !== 4
            || m.duration !== SMOKE_DURATION || m.timingId !== config.timingId || (m.variant ?? 'ice') !== this.variant
            || m.sourceFrameIndices.length !== SMOKE_FRAMES || m.sourceFrameIndices.some((frame, i) => frame !== config.sourceFrame(i))
            || JSON.stringify(m.preset) !== JSON.stringify(config.preset)
            || JSON.stringify(m.opening) !== JSON.stringify(SMOKE_OPENING)
            || m.domainSize !== this.domainSize || m.domainMin.join(',') !== this.domainMin.toArray().join(',')) {
            throw new Error('Replay does not match the current preset/opening contract');
        }
        for (const [name, hash] of Object.entries(sourceHashes)) {
            if (name === 'groundEvents.ts' && this.variant !== 'ground') continue;
            if (hash !== m.sources[name]) throw new Error(`Replay source changed: ${name}; export again`);
        }
        if (await getPokeballHash() !== m.modelSHA256) throw new Error('Replay model changed; export again');
        const name = this.mobile ? 'mobile' : 'desktop';
        if (m.name !== name) throw new Error('Wrong smoke device profile');
        this.profile = m.profile;
        const p = this.profile;
        if (p.resolution !== this.densityResolution || p.tiles !== this.densityTiles
            || p.width !== p.tiles * p.resolution || p.height !== Math.ceil(p.resolution / p.tiles) * p.resolution
            || p.channels !== 1 || p.velocityResolution !== (this.mobile ? 48 : 64)
            || p.lightSteps !== (this.mobile ? 6 : 8)
            || p.chunks.reduce((n, chunk) => n + chunk.count, 0) !== SMOKE_FRAMES
            || p.chunks.some((chunk, index) => chunk.first !== index * 4 || chunk.count !== Math.min(4, SMOKE_FRAMES - index * 4)
                || chunk.frames.length !== chunk.count || chunk.rawBytes !== p.width * p.height * p.channels * 2 * chunk.count
                || chunk.bytes <= 0 || !/^[a-f0-9]{64}$/.test(chunk.sha256))) throw new Error('Invalid replay atlas layout');
        if (this.disposed) throw new Error('Replay disposed');
        this.linearFiltering = probeSmokeFiltering(this.renderer);
        this.upload = new THREE.DataTexture(null, p.width, p.height, THREE.RedFormat, THREE.HalfFloatType);
        this.targets = Array.from({ length: 2 }, () => {
            const target = new THREE.WebGLRenderTarget(p.width, p.height, { format: THREE.RedFormat, type: THREE.HalfFloatType,
                minFilter: this.linearFiltering ? THREE.LinearFilter : THREE.NearestFilter,
                magFilter: this.linearFiltering ? THREE.LinearFilter : THREE.NearestFilter, depthBuffer: false });
            target.texture.generateMipmaps = false; target.texture.unpackAlignment = 1;
            this.renderer.initRenderTarget(target);
            return target;
        });
        await this.prepareChunks(0);
        this.downloadMs = performance.now() - started;
    }
    private async prepareChunks(frame: number): Promise<void> {
        const token = ++this.prepareSerial;
        const chunkIndex = Math.floor(frame / 4);
        this.store.activate(chunkIndex);
        await this.store.load(chunkIndex);
        if (this.disposed || token !== this.prepareSerial) return;
        if (!this.verifiedChunks.has(chunkIndex)) { this.verifiedChunks.add(chunkIndex); this.decodedFrames += this.profile.chunks[chunkIndex]!.count; }
        if (chunkIndex + 1 < this.profile.chunks.length) {
            await this.store.load(chunkIndex + 1);
            if (!this.disposed && token === this.prepareSerial) {
                if (!this.verifiedChunks.has(chunkIndex + 1)) { this.verifiedChunks.add(chunkIndex + 1); this.decodedFrames += this.profile.chunks[chunkIndex + 1]!.count; }
            }
        }
    }
    async prepare(time: number): Promise<void> {
        await this.ready;
        if (this.disposed) throw new Error('Replay disposed');
        if (this.prefetchError) throw this.prefetchError;
        const frame = this.index(time), chunk = Math.floor(frame / 4);
        this.store.activate(chunk);
        if (!this.chunks.has(chunk) || (chunk + 1 < this.profile.chunks.length && !this.chunks.has(chunk + 1))) await this.prepareChunks(frame);
    }
    /** Deactivation retains startup data, cancelling stale rolling prefetch ownership. */
    deactivate(): void { this.prepareSerial++; this.store.retainStartup(); }
    hasFrame(time: number): boolean { return !this.disposed && this.chunks.has(Math.floor(this.index(time) / 4)); }
    advanceTo(time: number): void {
        if (this.disposed) return;
        const frame = this.index(time), previousFrame = this.frame;
        if (this.frame === frame) return;
        const data = this.chunks.get(Math.floor(frame / 4));
        if (!data) throw new Error('Host must prepare the replay frame before advancing time');
        const start = performance.now(), p = this.profile;
        const stride = p.width * p.height * p.channels;
        this.active = 1 - this.active;
        const upload = this.upload!;
        upload.image.data = new Uint16Array(data, (frame % 4) * stride * 2, stride);
        this.timer.begin();
        try { this.renderer.copyTextureToTexture(upload, this.texture); }
        finally { this.timer.end(); upload.image.data = null; }
        this.boundary.sample(smokeProfile(this.variant).sourceFrame(frame) * this.dt, this.dt);
        this.frame = frame; this.fieldVersion++; this.uploaded++;
        this.uploadTimes.push(performance.now() - start);
        if (this.uploadTimes.length > 400) this.uploadTimes.shift();
        if (Math.floor(frame / 4) !== Math.floor(previousFrame / 4) && frame > 0)
            void this.prepare(frame * this.dt).catch(error => { this.prefetchError = error; });
    }
    reset(): void { this.frame = -1; this.fieldVersion++; }
    clearTiming(): void { this.timer.clear(); this.store.decodeTimes.length = 0; this.uploadTimes = []; }
    getDebugInfo() {
        return { source: 'replay', frame: this.frame, sourceFrame: this.frame < 0 ? -1 : smokeProfile(this.variant).sourceFrame(this.frame), version: this.version, solverPasses: 0,
            manifestId: this.manifest?.id, encodingBits: this.manifest?.encoding.bits, densityResolution: this.densityResolution,
            dataBytes: this.profile ? this.profile.width * this.profile.height * this.profile.channels * 2 * this.targets.length : 0,
            decodedBytes: [...this.chunks.values()].reduce((n, data) => n + data.byteLength, 0), chunks: this.chunks.size,
            uploads: this.uploaded, decodedFrames: this.decodedFrames, decodeCpu: stats(this.store.decodeTimes), uploadCpu: stats(this.uploadTimes), transfer: stats([this.store.transferMs]), uploadGpu: this.timer.stats(),
            prepareInitialMs: this.downloadMs, transferredBytes: this.store.cacheHit ? 0 : this.store.downloadedBytes, totalBytes: this.profile?.totalBytes,
            compressedBytes: this.disposed ? 0 : this.store.downloadedBytes, cacheHit: this.store.cacheHit,
            sourceUrl: this.store.url, decodedSegments: this.store.decodedSegments,
            storage: 'shared worker, pinned startup segments, optional versioned CacheStorage', disposed: this.disposed };
    }
    /** Explicit QA access; normal playback never reads fields back. */
    frameData(): Uint16Array | null {
        const data = this.chunks.get(Math.floor(this.frame / 4));
        if (!data) return null;
        const stride = this.profile.width * this.profile.height * this.profile.channels;
        return new Uint16Array(data, this.frame % 4 * stride * 2, stride);
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.prepareSerial++; this.store.release();
        for (const target of this.targets) target.dispose();
        this.targets = []; this.upload?.dispose(); this.upload = undefined; this.timer.dispose();
    }
}
