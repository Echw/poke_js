import * as THREE from 'three';
import { fullscreenVertex, simulationFragment } from './gpuSmokeShaders';
import { SmokeBoundarySampler } from './smokeBoundary';
import { GpuTimer } from './gpuTimer';

export interface SmokeSimulationSettings {
    emission: number;
    fallSpeed: number;
    spread: number;
    turbulence: number;
    fadeTime: number;
    adhesion: number;
    curlStrength: number;
}
type Pair = { read: THREE.WebGLRenderTarget; write: THREE.WebGLRenderTarget };
type Checkpoint = {
    step: number;
    velocity: THREE.WebGLRenderTarget;
    density: THREE.WebGLRenderTarget;
    valid: boolean;
};
const SIMULATION_KEYS = [
    'emission',
    'fallSpeed',
    'spread',
    'turbulence',
    'fadeTime',
    'adhesion',
    'curlStrength',
] as const;

/** 3D MAC grid in an atlas. Pressure stores impulse q: L(q)=div(v), v'=v-grad(q). */
export class GpuSmokeSimulation {
    readonly resolution: number;
    readonly tiles: number;
    readonly atlasSize: THREE.Vector2;
    readonly densityResolution: number;
    readonly densityTiles: number;
    readonly densityAtlasSize: THREE.Vector2;
    readonly domainMin = new THREE.Vector3(-1.7, -2.4, -1.7);
    readonly domainSize = 3.4;
    readonly dt = 1 / 60;
    readonly timer: GpuTimer;
    readonly format: string;
    readonly linearFiltering: boolean;
    readonly linearProbe: number[];
    readonly formatProbe: { scalarFbo: boolean; scalarReadback: number; rgbaReadback: number };
    private readonly renderer: THREE.WebGLRenderer;
    private readonly camera: THREE.Camera;
    private readonly boundary: SmokeBoundarySampler;
    private readonly settings: SmokeSimulationSettings;
    private readonly uniforms: Record<string, THREE.IUniform>;
    private readonly scene = new THREE.Scene();
    private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private readonly materials = new Map<string, THREE.ShaderMaterial>();
    private readonly targets: THREE.WebGLRenderTarget[] = [];
    private readonly velocity: Pair;
    private readonly density: Pair;
    private readonly pressure: Pair;
    private readonly mask: THREE.WebGLRenderTarget;
    private readonly stencil: THREE.WebGLRenderTarget;
    private readonly curl: THREE.WebGLRenderTarget;
    private readonly divergence: THREE.WebGLRenderTarget;
    private postDivergence?: THREE.WebGLRenderTarget;
    private readonly forward: THREE.WebGLRenderTarget;
    private readback?: THREE.WebGLRenderTarget;
    private densityReadback?: THREE.WebGLRenderTarget;
    private densityMask?: THREE.WebGLRenderTarget;
    private fieldVersion = 0;
    private readonly checkpoints: Checkpoint[] = [];
    private readonly savedViewport = new THREE.Vector4();
    private readonly savedScissor = new THREE.Vector4();
    private readonly savedColor = new THREE.Color();
    private step = 0;
    private passes = 0;
    private signature = '';
    private disposed = false;
    private readonly iterations: number;
    private checkpointRestores = 0;
    private lastProjectionStep = 0;

    constructor(
        renderer: THREE.WebGLRenderer,
        camera: THREE.Camera,
        boundary: SmokeBoundarySampler,
        settings: SmokeSimulationSettings,
        mobile = false,
    ) {
        this.renderer = renderer;
        this.camera = camera;
        this.boundary = boundary;
        this.settings = settings;
        this.iterations = mobile ? 48 : 64;
        this.resolution = mobile ? 48 : 64;
        this.tiles = Math.ceil(Math.sqrt(this.resolution));
        this.atlasSize = new THREE.Vector2(
            this.tiles * this.resolution,
            Math.ceil(this.resolution / this.tiles) * this.resolution,
        );
        this.densityResolution = this.resolution * 2;
        this.densityTiles = Math.ceil(Math.sqrt(this.densityResolution));
        this.densityAtlasSize = new THREE.Vector2(
            this.densityTiles * this.densityResolution,
            Math.ceil(this.densityResolution / this.densityTiles) * this.densityResolution,
        );
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (!gl.getExtension('EXT_color_buffer_float'))
            throw new Error('GPU smoke requires EXT_color_buffer_float');
        this.timer = new GpuTimer(gl);
        const scalarProbe = this.probe(THREE.RedFormat),
            rgbaProbe = this.probe(THREE.RGBAFormat);
        if (!rgbaProbe.complete || Math.abs(rgbaProbe.value - 0.375) > 0.005)
            throw new Error('RGBA16F smoke target failed its write/read probe');
        const scalarFormat =
            scalarProbe.complete && Math.abs(scalarProbe.value - 0.375) < 0.005
                ? THREE.RedFormat
                : THREE.RGBAFormat;
        this.format = scalarFormat === THREE.RedFormat ? 'R16F' : 'RGBA16F scalar fallback';
        this.linearProbe = this.probeLinear(scalarFormat);
        this.linearFiltering = this.linearProbe.every((value, i) => Math.abs(value - [0.25, 0.75][i]) < 0.01);
        this.formatProbe = {
            scalarFbo: scalarProbe.complete,
            scalarReadback: scalarProbe.value,
            rgbaReadback: rgbaProbe.value,
        };
        this.uniforms = {
            uN: { value: this.resolution },
            uTiles: { value: this.tiles },
            uH: { value: this.domainSize / this.resolution },
            uDomainMin: { value: this.domainMin },
            uVelocityN: { value: this.resolution },
            uVelocityTiles: { value: this.tiles },
            uVelocityH: { value: this.domainSize / this.resolution },
            uDensityN: { value: this.densityResolution },
            uDensityTiles: { value: this.densityTiles },
            uDensityH: { value: this.domainSize / this.densityResolution },
            uDt: { value: this.dt },
            uTime: { value: 0 },
            uOpening: { value: 0 },
            uWorldToBowl: { value: boundary.worldToBowl },
            uBowlToWorld: { value: boundary.bowlToWorld },
            uWorldToLid: { value: boundary.worldToLid },
            uBowlToPrevious: { value: boundary.bowlToPrevious },
            uLidToPrevious: { value: boundary.lidToPrevious },
            ...Object.fromEntries(
                [
                    'uInput',
                    'uVelocity',
                    'uDensity',
                    'uMask',
                    'uCurl',
                    'uPressure',
                    'uDivergence',
                    'uOriginal',
                    'uStencil',
                ].map((name) => [name, { value: null }]),
            ),
            ...Object.fromEntries(
                ['emission', 'fallSpeed', 'spread', 'turbulence', 'fadeTime', 'adhesion', 'curlStrength'].map(
                    (name) => ['u' + name[0].toUpperCase() + name.slice(1), { value: 0 }],
                ),
            ),
        };
        this.velocity = this.pair(THREE.RGBAFormat);
        this.density = { read: this.target(scalarFormat, THREE.HalfFloatType, true), write: this.target(scalarFormat, THREE.HalfFloatType, true) };
        if (this.linearFiltering) for (const target of [this.density.read, this.density.write]) {
            target.texture.minFilter = THREE.LinearFilter;
            target.texture.magFilter = THREE.LinearFilter;
        }
        this.pressure = this.pair(scalarFormat);
        this.mask = this.target(THREE.RGBAFormat);
        this.stencil = this.target(scalarFormat);
        this.curl = this.target(THREE.RGBAFormat);
        this.divergence = this.target(scalarFormat);
        this.forward = this.target(scalarFormat, THREE.HalfFloatType, true);
        for (let i = 0; i <= 12; i++)
            this.checkpoints.push({
                step: i * 30,
                velocity: this.target(THREE.RGBAFormat),
                density: this.target(scalarFormat, THREE.HalfFloatType, true),
                valid: false,
            });
        for (const name of [
            'MASK',
            'STENCIL',
            'DENSITY_MASK',
            'COPY',
            'ADVECT_VELOCITY',
            'CURL',
            'FORCES',
            'DIVERGENCE',
            'PRESSURE',
            'PROJECT',
            'DENSITY_FORWARD',
            'DENSITY_CORRECT',
        ]) {
            this.materials.set(
                name,
                new THREE.ShaderMaterial({
                    glslVersion: THREE.GLSL3,
                    defines: { ['PASS_' + name]: 1 },
                    uniforms: this.uniforms,
                    vertexShader: fullscreenVertex,
                    fragmentShader: simulationFragment,
                    depthTest: false,
                    depthWrite: false,
                    blending: THREE.NoBlending,
                    toneMapped: false,
                }),
            );
        }
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materials.get('COPY')!);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
        this.reset();
    }

    get texture(): THREE.Texture {
        return this.density.read.texture;
    }
    get velocityTexture(): THREE.Texture { return this.velocity.read.texture; }
    get version(): number { return this.fieldVersion; }
    get simulatedTime(): number {
        return this.step * this.dt;
    }

    /** Fixed-step replay from the nearest valid half-second checkpoint. No frame dt enters the solver. */
    advanceTo(time: number): void {
        if (this.disposed) return;
        const signature = this.settingsSignature();
        if (signature !== this.signature) {
            this.reset();
            this.signature = signature;
        }
        const desired = Math.max(0, Math.min(360, Math.floor(time / this.dt + 0.00001)));
        this.passes = 0;
        this.preserve(() => {
            if (desired < this.step) {
                const checkpoint = [...this.checkpoints].reverse().find((c) => c.valid && c.step <= desired)!;
                this.copy(checkpoint.velocity, this.velocity.read);
                this.copy(checkpoint.density, this.density.read);
                this.step = checkpoint.step;
                this.fieldVersion++;
                this.checkpointRestores++;
                this.lastProjectionStep = -1;
                this.boundary.sample(this.step * this.dt, this.dt);
                this.pass('MASK', this.mask);
            }
            const count = desired - this.step;
            if (count > 0) this.timer.begin(count);
            try {
                while (this.step < desired) {
                    this.tick();
                    this.step++;
                    this.fieldVersion++;
                    if (this.step % 30 === 0) {
                        const c = this.checkpoints[this.step / 30];
                        this.copy(this.velocity.read, c.velocity);
                        this.copy(this.density.read, c.density);
                        c.valid = true;
                    }
                }
            } finally {
                if (count > 0) this.timer.end();
            }
        });
    }

    reset(): void {
        if (this.disposed) return;
        this.timer.clear();
        this.preserve(() => {
            for (const target of this.targets) {
                this.renderer.setRenderTarget(target);
                this.renderer.clear();
            }
        });
        this.step = 0;
        this.fieldVersion++;
        this.lastProjectionStep = 0;
        this.checkpointRestores = 0;
        this.signature = this.settingsSignature();
        this.checkpoints.forEach((c) => (c.valid = c.step === 0));
    }

    private tick(): void {
        this.boundary.sample((this.step + 1) * this.dt, this.dt);
        this.uniforms.uTime.value = (this.step + 1) * this.dt;
        this.uniforms.uOpening.value = this.boundary.opening;
        for (const key of SIMULATION_KEYS) {
            const value = this.settings[key];
            const name = 'u' + key[0].toUpperCase() + key.slice(1);
            if (this.uniforms[name])
                this.uniforms[name].value = Math.max(0, Number.isFinite(value) ? value : 0);
        }
        this.pass('MASK', this.mask);
        this.uniforms.uMask.value = this.mask.texture;
        this.pass('STENCIL', this.stencil);
        this.uniforms.uStencil.value = this.stencil.texture;
        this.uniforms.uVelocity.value = this.velocity.read.texture;
        this.pass('ADVECT_VELOCITY', this.velocity.write);
        this.swap(this.velocity);
        this.uniforms.uVelocity.value = this.velocity.read.texture;
        this.pass('CURL', this.curl);
        this.uniforms.uCurl.value = this.curl.texture;
        this.uniforms.uDensity.value = this.density.read.texture;
        this.pass('FORCES', this.velocity.write);
        this.swap(this.velocity);
        this.uniforms.uVelocity.value = this.velocity.read.texture;
        this.pass('DIVERGENCE', this.divergence);
        this.uniforms.uDivergence.value = this.divergence.texture;
        this.renderer.setRenderTarget(this.pressure.read);
        this.renderer.clear();
        for (let i = 0; i < this.iterations; i++) {
            this.uniforms.uPressure.value = this.pressure.read.texture;
            this.pass('PRESSURE', this.pressure.write);
            this.swap(this.pressure);
        }
        this.uniforms.uPressure.value = this.pressure.read.texture;
        this.pass('PROJECT', this.velocity.write);
        this.swap(this.velocity);
        this.uniforms.uVelocity.value = this.velocity.read.texture;
        this.lastProjectionStep = this.step + 1;
        this.uniforms.uInput.value = this.density.read.texture;
        this.pass('DENSITY_FORWARD', this.forward);
        this.uniforms.uInput.value = this.forward.texture;
        this.uniforms.uOriginal.value = this.density.read.texture;
        this.pass('DENSITY_CORRECT', this.density.write);
        this.swap(this.density);
    }
    private pass(name: string, target: THREE.WebGLRenderTarget): void {
        const fine = target.width === this.densityAtlasSize.x;
        const n = fine ? this.densityResolution : this.resolution;
        this.uniforms.uN.value = n;
        this.uniforms.uTiles.value = fine ? this.densityTiles : this.tiles;
        this.uniforms.uH.value = this.domainSize / n;
        this.quad.material = this.materials.get(name)!;
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);
        this.passes++;
    }
    private copy(source: THREE.WebGLRenderTarget, target: THREE.WebGLRenderTarget): void {
        this.uniforms.uInput.value = source.texture;
        this.pass('COPY', target);
    }
    private swap(pair: Pair): void {
        const t = pair.read;
        pair.read = pair.write;
        pair.write = t;
    }
    private settingsSignature(): string {
        return JSON.stringify(SIMULATION_KEYS.map((key) => this.settings[key]));
    }
    private pair(format: THREE.PixelFormat): Pair {
        return { read: this.target(format), write: this.target(format) };
    }
    private target(
        format: THREE.PixelFormat,
        type: THREE.TextureDataType = THREE.HalfFloatType,
        fine = false,
    ): THREE.WebGLRenderTarget {
        const size = fine ? this.densityAtlasSize : this.atlasSize;
        const target = new THREE.WebGLRenderTarget(size.x, size.y, {
            format,
            type,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            depthBuffer: false,
            stencilBuffer: false,
        });
        target.texture.colorSpace = THREE.NoColorSpace;
        this.targets.push(target);
        return target;
    }

    private preserve(action: () => void): void {
        const target = this.renderer.getRenderTarget(),
            auto = this.renderer.autoClear,
            alpha = this.renderer.getClearAlpha(),
            scissorTest = this.renderer.getScissorTest();
        this.renderer.getViewport(this.savedViewport);
        this.renderer.getScissor(this.savedScissor);
        this.renderer.getClearColor(this.savedColor);
        try {
            this.renderer.autoClear = true;
            this.renderer.setScissorTest(false);
            this.renderer.setClearColor(0, 0);
            action();
        } finally {
            this.renderer.setRenderTarget(target);
            this.renderer.setViewport(this.savedViewport);
            this.renderer.setScissor(this.savedScissor);
            this.renderer.setScissorTest(scissorTest);
            this.renderer.setClearColor(this.savedColor, alpha);
            this.renderer.autoClear = auto;
        }
    }

    /** Probe actual framebuffer completeness and a fractional write/read, not extension presence alone. */
    private probe(format: THREE.PixelFormat): { complete: boolean; value: number } {
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        const target = new THREE.WebGLRenderTarget(2, 2, {
            format,
            type: THREE.HalfFloatType,
            depthBuffer: false,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        });
        let complete = false,
            value = NaN;
        try {
            this.preserve(() => {
                this.renderer.setRenderTarget(target);
                complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
                if (complete) {
                    this.renderer.setClearColor(new THREE.Color(0.375, 0.125, 0.5), 1);
                    this.renderer.clear();
                    const readFormat = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT),
                        readType = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
                    if (readType === gl.FLOAT) {
                        const data = new Float32Array(4);
                        gl.readPixels(0, 0, 1, 1, readFormat, readType, data);
                        value = data[0];
                    } else if (readType === gl.HALF_FLOAT) {
                        const data = new Uint16Array(4);
                        gl.readPixels(0, 0, 1, 1, readFormat, readType, data);
                        value = THREE.DataUtils.fromHalfFloat(data[0]);
                    } else if (readType === gl.UNSIGNED_BYTE) {
                        const data = new Uint8Array(4);
                        gl.readPixels(0, 0, 1, 1, readFormat, readType, data);
                        value = data[0] / 255;
                    }
                }
            });
        } finally {
            target.dispose();
        }
        return { complete, value };
    }

    /** Check interpolation in the chosen half-float format, rather than relying on extensions. */
    private probeLinear(format: THREE.PixelFormat): number[] {
        const components = format === THREE.RedFormat ? 1 : 4;
        const values = new Uint16Array(components * 2);
        values.fill(THREE.DataUtils.toHalfFloat(1), components);
        const input = new THREE.DataTexture(values, 2, 1, format, THREE.HalfFloatType);
        input.minFilter = input.magFilter = THREE.LinearFilter;
        input.generateMipmaps = false;
        input.needsUpdate = true;
        const output = new THREE.WebGLRenderTarget(2, 1, { depthBuffer: false });
        const material = new THREE.ShaderMaterial({
            uniforms: { uInput: { value: input } },
            vertexShader: fullscreenVertex,
            fragmentShader: 'uniform sampler2D uInput;void main(){float d=texture2D(uInput,vec2(0.25+gl_FragCoord.x*0.25,0.5)).r;gl_FragColor=vec4(d,0,0,1);}',
            toneMapped: false, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        quad.frustumCulled = false;
        const scene = new THREE.Scene();scene.add(quad);
        const data = new Uint8Array(8);
        try {
            this.preserve(() => {
                this.renderer.setRenderTarget(output);
                this.renderer.render(scene, this.camera);
                this.renderer.readRenderTargetPixels(output, 0, 0, 2, 1, data);
            });
        } finally {
            input.dispose();output.dispose();quad.geometry.dispose();material.dispose();
        }
        return [data[0] / 255, data[4] / 255];
    }

    /** Explicit, readback-based diagnostics. Never called in ordinary animation frames. */
    diagnostics() {
        if (this.disposed) throw new Error('Cannot inspect disposed smoke simulation');
        const scalarFormat = this.density.read.texture.format === THREE.RedFormat ? THREE.RedFormat : THREE.RGBAFormat;
        const postDivergence = this.postDivergence ??= this.target(scalarFormat);
        const coarseReadback = this.readback ??= this.target(THREE.RGBAFormat, THREE.FloatType);
        const fineReadback = this.densityReadback ??= this.target(THREE.RGBAFormat, THREE.FloatType, true);
        const fineMask = this.densityMask ??= this.target(scalarFormat, THREE.HalfFloatType, true);
        let result = {
            beforeRms: 0,
            afterRms: 0,
            densityMin: Infinity,
            densityMax: -Infinity,
            solidDensityMax: 0,
            nonFinite: 0,
            maxWallFluxError: 0,
            stateHash: 0,
            projectionSampleStep: this.lastProjectionStep,
            step: this.step,
            densityMass: 0,
            centroidY: 0,
            maxVelocityComponent: 0,
        };
        this.preserve(() => {
            this.uniforms.uVelocity.value = this.velocity.read.texture;
            this.pass('DIVERGENCE', postDivergence);
            this.pass('DENSITY_MASK', fineMask);
            const read = (target: THREE.WebGLRenderTarget) => {
                const readback = target.width === this.densityAtlasSize.x ? fineReadback : coarseReadback;
                this.copy(target, readback);
                const buffer = new Float32Array(readback.width * readback.height * 4);
                this.renderer.readRenderTargetPixels(
                    readback,
                    0,
                    0,
                    readback.width,
                    readback.height,
                    buffer,
                );
                return buffer;
            };
            const before = read(this.divergence),
                after = read(postDivergence),
                density = read(this.density.read),
                densityMask = read(fineMask),
                mask = read(this.mask),
                velocity = read(this.velocity.read);
            let hash = 2166136261;
            for (const data of [density, velocity])
                for (const word of new Uint32Array(data.buffer)) hash = Math.imul(hash ^ word, 16777619);
            result.stateHash = hash >>> 0;
            let count = 0,
                pre = 0,
                post = 0;
            const index = (x: number, y: number, z: number) =>
                (x +
                    (z % this.tiles) * this.resolution +
                    (y + Math.floor(z / this.tiles) * this.resolution) * this.atlasSize.x) *
                4;
            for (let z = 0; z < this.resolution; z++)
                for (let y = 0; y < this.resolution; y++)
                    for (let x = 0; x < this.resolution; x++) {
                        const i = index(x, y, z), solid = mask[i + 3] > 0.5;
                        if (
                            ![before[i], after[i], velocity[i], velocity[i + 1], velocity[i + 2]].every(
                                Number.isFinite,
                            )
                        )
                            result.nonFinite++;
                        result.maxVelocityComponent = Math.max(
                            result.maxVelocityComponent,
                            Math.abs(velocity[i]),
                            Math.abs(velocity[i + 1]),
                            Math.abs(velocity[i + 2]),
                        );
                        if (!solid) {
                            pre += before[i] ** 2;
                            post += after[i] ** 2;
                            count++;
                        }
                        for (let a = 0; a < 3; a++) {
                            const neighbor = [x, y, z];
                            neighbor[a]++;
                            const outside = neighbor[a] >= this.resolution,
                                j = outside ? -1 : index(neighbor[0], neighbor[1], neighbor[2]);
                            const ns = outside || mask[j + 3] > 0.5;
                            if (solid || ns) {
                                const wall =
                                    ((solid ? mask[i + a] : 0) + (ns && !outside ? mask[j + a] : 0)) /
                                    Math.max((solid ? 1 : 0) + (ns ? 1 : 0), 1);
                                result.maxWallFluxError = Math.max(
                                    result.maxWallFluxError,
                                    Math.abs(velocity[i + a] - wall),
                                );
                            }
                        }
                    }
            const n = this.densityResolution, tiles = this.densityTiles;
            for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
                const i = (x + (z % tiles) * n + (y + Math.floor(z / tiles) * n) * this.densityAtlasSize.x) * 4;
                const d = density[i];
                if (!Number.isFinite(d)) result.nonFinite++;
                result.densityMin = Math.min(result.densityMin, d);
                result.densityMax = Math.max(result.densityMax, d);
                result.densityMass += d;
                result.centroidY += d * (this.domainMin.y + (y + 0.5) * this.domainSize / n);
                if (densityMask[i] > 0.5) result.solidDensityMax = Math.max(result.solidDensityMax, Math.abs(d));
            }
            result.beforeRms = Math.sqrt(pre / Math.max(count, 1));
            result.afterRms = Math.sqrt(post / Math.max(count, 1));
            result.centroidY /= Math.max(result.densityMass, 0.000001);
            result.densityMass *= Math.pow(this.domainSize / this.densityResolution, 3);
        });
        return result;
    }
    getDebugInfo() {
        const bytes = (target: THREE.WebGLRenderTarget) => target.width * target.height
            * (target.texture.format === THREE.RedFormat ? 1 : 4)
            * (target.texture.type === THREE.FloatType ? 4 : 2);
        return {
            kind: 'MAC 3D',
            resolution: this.resolution,
            velocityResolution: this.resolution,
            densityResolution: this.densityResolution,
            velocityAtlas: this.atlasSize.toArray(),
            densityAtlas: this.densityAtlasSize.toArray(),
            dataBytes: this.targets.reduce((sum, target) => sum + bytes(target), 0),
            velocityGridBytes: this.targets.filter(target => target.width === this.atlasSize.x).reduce((sum, target) => sum + bytes(target), 0),
            densityGridBytes: this.targets.filter(target => target.width === this.densityAtlasSize.x).reduce((sum, target) => sum + bytes(target), 0),
            dt: this.dt,
            time: this.simulatedTime,
            step: this.step,
            pressureIterations: this.iterations,
            format: this.format,
            formatProbe: this.formatProbe,
            linearFiltering: this.linearFiltering,
            linearProbe: this.linearProbe,
            diagnosticBytes: [this.postDivergence, this.readback, this.densityReadback, this.densityMask]
                .reduce((sum, target) => sum + (target ? bytes(target) : 0), 0),
            passes: this.passes,
            checkpoints: this.checkpoints.filter((c) => c.valid).length,
            checkpointRestores: this.checkpointRestores,
            targetCount: this.targets.length,
            gpu: this.timer.stats(),
        };
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.timer.dispose();
        for (const t of this.targets) t.dispose();
        for (const m of this.materials.values()) m.dispose();
        this.quad.geometry.dispose();
        this.quad.removeFromParent();
    }
}
