import * as THREE from 'three';
import { GpuSmokeSimulation } from './gpuSmokeSimulation';
import { SmokeBoundarySampler } from './smokeBoundary';
import { GpuTimer } from './gpuTimer';
import { gpuVolumeFragment, gpuVolumeVertex } from './gpuSmokeRender';
import { GpuSmokeOccupancy } from './gpuSmokeOccupancy';
import { SmokeReplay } from './smokeReplay';
import { SmokeBaker, SmokeFieldReadback } from './smokeBake';
import { SMOKE_PRESET } from './smokeReplayTypes';
import type { SmokeField } from './smokeReplayTypes';
import { SMOKE_DURATION, SMOKE_DT, smokeFrame, smokeSourceFrame, smokeSourceTime } from './smokeTiming';

export const GPU_SMOKE_DEFAULTS = SMOKE_PRESET;
const PHYSICS_KEYS = ['emission', 'fallSpeed', 'spread', 'turbulence', 'fadeTime', 'adhesion', 'curlStrength'] as const;

/** Ice volume playback; the host owns rendering and the 3.5-second reveal clock. */
export class GpuSmokeMist {
    readonly settings = { ...GPU_SMOKE_DEFAULTS };
    readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
    simulation?: GpuSmokeSimulation;
    replay?: SmokeReplay;
    ready: Promise<void>;
    readonly timer: GpuTimer;
    readonly occupancy: GpuSmokeOccupancy;
    mode: 'reference' | 'optimized' = 'optimized';
    /** Render-only controls never invalidate the simulation checkpoints. */
    debugView: 'lighting' | 'density' | 'velocity' = 'lighting';
    private readonly volumeScene = new THREE.Scene();
    private readonly compositeScene = new THREE.Scene();
    private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    private readonly composite: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private readonly size = new THREE.Vector2();
    private readonly clearColor = new THREE.Color();
    private readonly scale: number;
    private readonly boundsMax = new THREE.Vector3();
    private desiredTime = 0;
    private disposed = false;
    private frames = 0;
    private field: SmokeField;
    private placeholder: THREE.DataTexture;
    private renderer: THREE.WebGLRenderer;
    private camera: THREE.Camera;
    private boundary: SmokeBoundarySampler;
    private mobile: boolean;
    private sourceEpoch = 0;
    private sourceReady = false;
    private fallbackReason?: string;
    private baker?: SmokeBaker;
    private readback?: SmokeFieldReadback;
    private cacheKey = '';
    private poseKey = '';
    private occlusionRevision = '';
    private cacheHits = 0;
    private volumeDraws = 0;
    constructor(
        renderer: THREE.WebGLRenderer,
        camera: THREE.Camera,
        boundary: SmokeBoundarySampler,
        mobile = false,
        source: 'live' | 'replay' = 'replay',
    ) {
        this.renderer = renderer; this.camera = camera; this.boundary = boundary; this.mobile = mobile;
        this.scale = mobile ? 0.6 : 0.75;
        this.settings.steps = mobile ? 96 : 128;
        this.placeholder = new THREE.DataTexture(new Uint16Array(1), 1, 1, THREE.RedFormat, THREE.HalfFloatType);
        this.placeholder.needsUpdate = true;
        this.field = { densityResolution: mobile ? 96 : 128, densityTiles: mobile ? 10 : 12,
            domainMin: new THREE.Vector3(-1.7, -2.4, -1.7), domainSize: 3.4, texture: this.placeholder, version: -1 };
        this.timer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
        this.occupancy = new GpuSmokeOccupancy(renderer, this.field);
        this.boundsMax.copy(this.field.domainMin).addScalar(this.field.domainSize);
        this.mesh = new THREE.Mesh(
            new THREE.BoxGeometry(
                this.field.domainSize,
                this.field.domainSize,
                this.field.domainSize,
            ),
            new THREE.ShaderMaterial({
                glslVersion: THREE.GLSL3,
                uniforms: {
                    uN: { value: this.field.densityResolution },
                    uTiles: { value: this.field.densityTiles },
                    uH: { value: this.field.domainSize / this.field.densityResolution },
                    uVelocityN: { value: mobile ? 48 : 64 },
                    uVelocityTiles: { value: mobile ? 7 : 8 },
                    uVelocityH: { value: this.field.domainSize / (mobile ? 48 : 64) },
                    uVelocity: { value: this.placeholder },
                    uWorldToBowl: { value: boundary.worldToBowl },
                    uLightSteps: { value: mobile ? 6 : 8 },
                    uDebugView: { value: 0 },
                    uOptimized: { value: 1 },
                    uLinear: { value: 1 },
                    uOccupancy: { value: this.occupancy.texture },
                    uBrickN: { value: this.occupancy.resolution },
                    uBrickTiles: { value: this.occupancy.tiles },
                    uDomainMin: { value: this.field.domainMin },
                    uBoundsMin: { value: this.field.domainMin },
                    uBoundsMax: { value: this.boundsMax },
                    uField: { value: this.placeholder },
                    uDepth: { value: null },
                    uResolution: { value: new THREE.Vector2() },
                    uInvProjection: { value: new THREE.Matrix4() },
                    uCameraWorld: { value: new THREE.Matrix4() },
                    uSteps: { value: this.settings.steps },
                    uDensityScale: { value: this.settings.density },
                    uFade: { value: 1 },
                    uIceLight: { value: 0 },
                },
                vertexShader: gpuVolumeVertex,
                fragmentShader: gpuVolumeFragment,
                transparent: true,
                blending: THREE.NoBlending,
                side: THREE.BackSide,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
            }),
        );
        this.mesh.position.copy(this.field.domainMin).addScalar(this.field.domainSize * 0.5);
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        this.mesh.name = 'GpuSmokeVolume';
        this.volumeScene.add(this.mesh);
        this.composite = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            new THREE.ShaderMaterial({
                uniforms: { uFog: { value: this.target.texture } },
                transparent: true,
                depthTest: false,
                depthWrite: false,
                vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0,1);}`,
                fragmentShader: `uniform sampler2D uFog;varying vec2 vUv;void main(){gl_FragColor=texture2D(uFog,vUv);gl_FragColor.rgb/=max(gl_FragColor.a,0.0001);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
            }),
        );
        this.composite.frustumCulled = false;
        this.compositeScene.add(this.composite);
        this.ready = this.setSource(source);
    }
    /** Solver is allocated only for editing or an explicitly reported data fallback. */
    async setSource(source: 'live' | 'replay'): Promise<void> {
        const epoch = ++this.sourceEpoch;
        this.sourceReady = false;
        this.baker?.dispose(); this.baker = undefined;
        this.replay?.dispose(); this.replay = undefined;
        this.simulation?.dispose(); this.simulation = undefined;
        this.fallbackReason = undefined;
        if (source === 'replay') {
            for (const key of PHYSICS_KEYS) this.settings[key] = SMOKE_PRESET[key];
            let replay: SmokeReplay | undefined;
            try {
                replay = new SmokeReplay(this.renderer, this.boundary, this.mobile);
                this.replay = replay;
                await replay.ready;
                if (this.disposed || epoch !== this.sourceEpoch) { replay.dispose(); return; }
                this.field = replay;
            } catch (error) {
                replay?.dispose();
                if (this.disposed || epoch !== this.sourceEpoch) return;
                this.replay = undefined; this.fallbackReason = String(error);
                console.warn('Smoke replay unavailable; retaining full-quality live simulation.', error);
            }
        }
        if (!this.replay) {
            this.simulation = new GpuSmokeSimulation(this.renderer, this.camera, this.boundary, this.settings, this.mobile);
            this.simulation.advanceTo(this.simulation.dt); this.simulation.reset();
            this.field = this.simulation;
        }
        this.sourceReady = true; this.cacheKey = ''; this.occupancy.invalidate();
        this.mesh.material.uniforms.uLinear!.value = (this.replay ?? this.simulation)?.linearFiltering ? 1 : 0;
    }
    async prepare(time: number): Promise<void> {
        await this.ready;
        if (this.replay && PHYSICS_KEYS.some(key => this.settings[key] !== SMOKE_PRESET[key])) await this.setSource('live');
        const epoch = this.sourceEpoch;
        try { await this.replay?.prepare(time); }
        catch (error) {
            if (this.disposed || epoch !== this.sourceEpoch) return;
            await this.setSource('live');
            this.fallbackReason = String(error);
        }
    }
    hasFrame(time: number): boolean { return this.sourceReady && (!this.replay || this.replay.hasFrame(time)); }
    /** Prepare GPU programs before the host starts its reveal clock. */
    async warmup(): Promise<void> {
        await this.prepare(0);
        if (this.disposed) return;
        this.advanceTo(0);
        await this.renderer.compileAsync(this.volumeScene, this.camera);
        if (this.disposed) return;
        await this.renderer.compileAsync(this.compositeScene, this.camera);
        if (this.disposed) return;
        this.occupancy.update(this.renderer, this.camera, this.field);
        const renderer = this.renderer, previous = renderer.getRenderTarget(), auto = renderer.autoClear;
        const color = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha(), visible = this.mesh.visible;
        renderer.getDrawingBufferSize(this.size);
        this.target.setSize(Math.ceil(this.size.x * this.scale), Math.ceil(this.size.y * this.scale));
        const u = this.mesh.material.uniforms;
        u.uField.value = this.field.texture;
        u.uResolution.value.set(this.target.width, this.target.height);
        this.camera.updateWorldMatrix(true, false);
        u.uInvProjection.value.copy(this.camera.projectionMatrixInverse);
        u.uCameraWorld.value.copy(this.camera.matrixWorld);
        try {
            // Realize driver pipelines and buffers as well as GLSL programs. The
            // zero-density frame produces transparent fog, preserving the screen.
            this.mesh.visible = true;
            renderer.setRenderTarget(this.target); renderer.setClearColor(0, 0); renderer.autoClear = true;
            renderer.render(this.volumeScene, this.camera);
            renderer.setRenderTarget(previous); renderer.autoClear = false;
            renderer.render(this.compositeScene, this.camera);
        } finally {
            this.mesh.visible = visible; renderer.setRenderTarget(previous);
            renderer.setClearColor(color, alpha); renderer.autoClear = auto;
        }
    }
    advanceTo(time: number): void {
        if (this.replay) this.replay.advanceTo(time);
        else this.simulation?.advanceTo(smokeSourceFrame(smokeFrame(time)) * SMOKE_DT);
    }
    reset(): void { (this.replay ?? this.simulation)?.reset(); this.cacheKey = ''; }
    setOcclusionRevision(value: string): void { this.occlusionRevision = value; }
    clearReadback(): void { this.readback?.dispose(); this.readback = undefined; }
    exportFrame(frame: number): Uint16Array {
        if (!this.simulation) throw new Error('Export requires the live editing source');
        this.baker ??= new SmokeBaker(this.renderer, this.camera, this.simulation);
        return this.baker.exportFrame(frame);
    }
    /** Hash input for acceptance checks; buffers are allocated only on this call. */
    readField(): Uint16Array {
        const n = this.field.densityResolution, tiles = this.field.densityTiles;
        this.readback ??= new SmokeFieldReadback(this.renderer, n * tiles, n * Math.ceil(n / tiles));
        return this.readback.read(this.field.texture);
    }
    update(
        time: number,
        opening: number,
        _source: THREE.Object3D,
        camera: THREE.PerspectiveCamera,
        depth: THREE.Texture,
    ): void {
        this.desiredTime = time;
        _source.updateWorldMatrix(true, false);
        this.poseKey = `${opening}:${_source.matrixWorld.elements.join(',')}`;
        camera.updateWorldMatrix(true, false);
        const u = this.mesh.material.uniforms;
        u.uDepth.value = depth;
        u.uInvProjection.value.copy(camera.projectionMatrixInverse);
        u.uCameraWorld.value.copy(camera.matrixWorld);
        u.uSteps.value = THREE.MathUtils.clamp(this.settings.steps, 24, 192);
        u.uDebugView.value = this.debugView === 'density' ? 1 : this.debugView === 'velocity' ? 2 : 0;
        u.uOptimized.value = this.mode === 'optimized' ? 1 : 0;
        u.uDensityScale.value = Math.max(0, this.settings.density);
        u.uIceLight.value = THREE.MathUtils.smoothstep(time, 0.15, 0.9)
            * (1 - THREE.MathUtils.smoothstep(time, 2.15, 3.05));
        u.uFade.value = 1 - THREE.MathUtils.smoothstep(smokeSourceTime(time), 5.7, 6);
        this.mesh.visible = time > 0.008 && time < SMOKE_DURATION && opening > 0.002;
    }
    render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
        if (this.disposed) return;
        if (!this.hasFrame(this.desiredTime)) return;
        this.advanceTo(this.desiredTime);
        this.mesh.material.uniforms.uField.value = this.field.texture;
        this.mesh.material.uniforms.uVelocity.value = this.simulation?.velocityTexture ?? this.placeholder;
        if (!this.mesh.visible) return;
        renderer.getDrawingBufferSize(this.size);
        const width = Math.max(1, Math.ceil(this.size.x * this.scale)),
            height = Math.max(1, Math.ceil(this.size.y * this.scale));
        if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
        this.mesh.material.uniforms.uResolution.value.set(width, height);
        const target = renderer.getRenderTarget(),
            alpha = renderer.getClearAlpha(),
            autoClear = renderer.autoClear;
        renderer.getClearColor(this.clearColor);
        // Alternate an occasional occupancy-only query; all other fog queries include its build.
        const key = [this.sourceEpoch, this.field.version, width, height, this.poseKey, this.occlusionRevision, this.mode, this.debugView,
            this.settings.steps, this.settings.density, this.mesh.material.uniforms.uFade.value, this.mesh.material.uniforms.uIceLight.value,
            ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements].join(':');
        const reuse = key === this.cacheKey;
        const measureMap = !reuse && this.mode === 'optimized' && this.occupancy.needsUpdate(this.field) && ++this.frames % 8 === 0;
        if (!measureMap) this.timer.begin();
        try {
            if (!reuse) {
                if (this.mode === 'optimized') this.occupancy.update(renderer, camera, this.field, measureMap);
                renderer.setRenderTarget(this.target);
                renderer.setClearColor(0, 0);
                renderer.autoClear = true;
                renderer.render(this.volumeScene, camera);
                this.cacheKey = key; this.volumeDraws++;
            } else this.cacheHits++;
            renderer.setRenderTarget(target);
            renderer.autoClear = false;
            renderer.render(this.compositeScene, camera);
        } finally {
            renderer.setRenderTarget(target);
            renderer.setClearColor(this.clearColor, alpha);
            renderer.autoClear = autoClear;
            if (!measureMap) this.timer.end();
        }
    }
    getDebugInfo() {
        return { revision: 3, source: this.replay ? 'replay' : 'live', fallbackReason: this.fallbackReason,
            ready: this.sourceReady, replay: this.replay?.getDebugInfo(), volumeDraws: this.volumeDraws, cacheHits: this.cacheHits,
            optimization: this.mode, sampler: this.mode === 'optimized' && (this.replay ?? this.simulation)?.linearFiltering ? 'hardwareXY+Z' : 'manual8',
            occupancy: this.occupancy.getDebugInfo(), debugView: this.debugView, settings: { ...this.settings }, renderScale: this.scale,
            lightSteps: this.mesh.material.uniforms.uLightSteps.value,
            simulation: this.simulation?.getDebugInfo(), fogGpu: this.timer.stats() };
    }
    /** Explicit QA readback of premultiplied linear fog; not used during playback. */
    readPixels(renderer: THREE.WebGLRenderer) {
        const pixels = new Uint8Array(this.target.width * this.target.height * 4);
        renderer.readRenderTargetPixels(this.target, 0, 0, this.target.width, this.target.height, pixels);
        return { width: this.target.width, height: this.target.height, pixels };
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.sourceEpoch++; this.sourceReady = false;
        this.baker?.dispose(); this.readback?.dispose(); this.replay?.dispose(); this.simulation?.dispose(); this.placeholder.dispose();
        this.timer.dispose();
        this.occupancy.dispose();
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.composite.removeFromParent();
        this.composite.geometry.dispose();
        this.composite.material.dispose();
        this.target.dispose();
    }
}
