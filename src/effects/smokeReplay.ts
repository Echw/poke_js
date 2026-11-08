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
import profileSource from './smokeProfile.ts?raw';
import type { ReplayProfile, SmokeReplayManifest } from './smokeReplayTypes';
import simulationSource from './gpuSmokeSimulation.ts?raw';
import shaderSource from './gpuSmokeShaders.ts?raw';
import boundarySource from './smokeBoundary.ts?raw';
import modelUrl from '../assets/pokeball.glb?url';
import { SMOKE_DT, SMOKE_DURATION, SMOKE_FRAMES, smokeFrame } from './smokeTiming';
import { probeSmokeFiltering } from './smokeTextureProbe';

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
    private worker: Worker;
    private initialization?: { resolve: (header: SmokeReplayManifest) => void; reject: (error: Error) => void };
    private abort = new AbortController();
    private disposed = false;
    private chunks = new Map<number, ArrayBuffer>();
    private loads = new Map<number, Promise<ArrayBuffer>>();
    private requests = new Map<number, { resolve: (data: ArrayBuffer) => void; reject: (error: Error) => void }>();
    private serial = 0;
    private prepareSerial = 0;
    private uploaded = 0;
    private downloadMs = 0;
    private downloadedBytes = 0;
    private decodeTimes: number[] = [];
    private uploadTimes: number[] = [];
    private transferTimes: number[] = [];
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
        this.worker = new Worker(new URL('./smokeReplayWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = event => {
            if (event.data.id === 0) {
                if (event.data.error) this.initialization?.reject(new Error(event.data.error));
                else {
                    this.downloadedBytes = event.data.bytes; this.transferTimes = event.data.transfers;
                    this.initialization?.resolve(event.data.header);
                }
                this.initialization = undefined; return;
            }
            const pending = this.requests.get(event.data.id);
            if (!pending) return;
            this.requests.delete(event.data.id);
            if (event.data.error) pending.reject(new Error(event.data.error));
            else {
                this.decodeTimes.push(event.data.decodeMs);
                if (this.decodeTimes.length > 400) this.decodeTimes.shift();
                pending.resolve(event.data.buffer);
            }
        };
        this.worker.onerror = event => {
            this.initialization?.reject(new Error(event.message)); this.initialization = undefined;
            for (const request of this.requests.values()) request.reject(new Error(event.message));
            this.requests.clear();
        };
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
        this.manifest = await new Promise<SmokeReplayManifest>((resolve, reject) => {
            this.initialization = { resolve, reject };
            const url = this.variant === 'poison' ? (this.mobile ? poisonMobileUrl : poisonDesktopUrl)
                : this.variant === 'fighting' ? (this.mobile ? fightingMobileUrl : fightingDesktopUrl)
                : (this.mobile ? mobileClipUrl : desktopClipUrl);
            this.worker.postMessage({ id: 0, kind: 'init', url: new URL(url, location.href).href });
        });
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
        const hex = async (data: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
        for (const [name, source] of Object.entries({ 'gpuSmokeSimulation.ts': simulationSource, 'gpuSmokeShaders.ts': shaderSource, 'smokeBoundary.ts': boundarySource, 'smokeProfile.ts': profileSource })) {
            if (await hex(new TextEncoder().encode(source.replace(/\r\n?/g, '\n'))) !== m.sources[name]) throw new Error(`Replay source changed: ${name}; export again`);
        }
        const modelResponse = await fetch(modelUrl, { signal: this.abort.signal });
        if (await hex(await modelResponse.arrayBuffer()) !== m.modelSHA256) throw new Error('Replay model changed; export again');
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
    private load(chunkIndex: number): Promise<ArrayBuffer> {
        const existing = this.chunks.get(chunkIndex);
        if (existing) return Promise.resolve(existing);
        const running = this.loads.get(chunkIndex);
        if (running) return running;
        const id = ++this.serial;
        const promise = new Promise<ArrayBuffer>((resolve, reject) => {
            this.requests.set(id, { resolve, reject });
            this.worker.postMessage({ id, segment: chunkIndex });
        });
        this.loads.set(chunkIndex, promise);
        void promise.finally(() => this.loads.delete(chunkIndex)).catch(() => {});
        return promise;
    }
    private async prepareChunks(frame: number): Promise<void> {
        const token = ++this.prepareSerial;
        const chunkIndex = Math.floor(frame / 4);
        // Drop obsolete CPU views, including DataTexture.image.data, before inflating another pair.
        for (const key of this.chunks.keys()) if (key !== chunkIndex && key !== chunkIndex + 1) this.chunks.delete(key);
        const data = await this.load(chunkIndex);
        if (this.disposed || token !== this.prepareSerial) return;
        this.chunks.set(chunkIndex, data);
        if (!this.verifiedChunks.has(chunkIndex)) { this.verifiedChunks.add(chunkIndex); this.decodedFrames += this.profile.chunks[chunkIndex]!.count; }
        if (chunkIndex + 1 < this.profile.chunks.length) {
            const next = await this.load(chunkIndex + 1);
            if (!this.disposed && token === this.prepareSerial) {
                this.chunks.set(chunkIndex + 1, next);
                if (!this.verifiedChunks.has(chunkIndex + 1)) { this.verifiedChunks.add(chunkIndex + 1); this.decodedFrames += this.profile.chunks[chunkIndex + 1]!.count; }
            }
        }
    }
    async prepare(time: number): Promise<void> {
        await this.ready;
        if (this.disposed) throw new Error('Replay disposed');
        if (this.prefetchError) throw this.prefetchError;
        const frame = this.index(time), chunk = Math.floor(frame / 4);
        if (!this.chunks.has(chunk) || (chunk + 1 < this.profile.chunks.length && !this.chunks.has(chunk + 1))) await this.prepareChunks(frame);
    }
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
    clearTiming(): void { this.timer.clear(); this.decodeTimes = []; this.uploadTimes = []; }
    getDebugInfo() {
        return { source: 'replay', frame: this.frame, sourceFrame: this.frame < 0 ? -1 : smokeProfile(this.variant).sourceFrame(this.frame), version: this.version, solverPasses: 0,
            manifestId: this.manifest?.id, encodingBits: this.manifest?.encoding.bits, densityResolution: this.densityResolution,
            dataBytes: this.profile ? this.profile.width * this.profile.height * this.profile.channels * 2 * this.targets.length : 0,
            decodedBytes: [...this.chunks.values()].reduce((n, data) => n + data.byteLength, 0), chunks: this.chunks.size,
            uploads: this.uploaded, decodedFrames: this.decodedFrames, decodeCpu: stats(this.decodeTimes), uploadCpu: stats(this.uploadTimes), transfer: stats(this.transferTimes), uploadGpu: this.timer.stats(),
            prepareInitialMs: this.downloadMs, transferredBytes: this.downloadedBytes, totalBytes: this.profile?.totalBytes,
            compressedBytes: this.disposed ? 0 : this.downloadedBytes,
            storage: 'project assets loaded once in worker memory; no CacheStorage', disposed: this.disposed };
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
        this.disposed = true; this.abort.abort(); this.worker.terminate();
        this.initialization?.reject(new Error('Replay disposed')); this.initialization = undefined;
        for (const pending of this.requests.values()) pending.reject(new Error('Replay disposed'));
        this.requests.clear(); this.loads.clear(); this.chunks.clear();
        for (const target of this.targets) target.dispose();
        this.targets = []; this.upload?.dispose(); this.upload = undefined; this.timer.dispose();
    }
}
