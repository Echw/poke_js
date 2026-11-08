import * as THREE from 'three';
import { fullscreenVertex, smokeGridGLSL } from './gpuSmokeShaders';
import type { SmokeField } from './smokeReplayTypes';
import { GpuTimer } from './gpuTimer';

/** Conservative GPU-only maximum for 8³ density cells, dilated by one whole brick. */
export class GpuSmokeOccupancy {
    readonly resolution: number;
    readonly tiles: number;
    readonly timer: GpuTimer;
    private readonly core: THREE.WebGLRenderTarget;
    private readonly expanded: THREE.WebGLRenderTarget;
    private readonly scene = new THREE.Scene();
    private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private readonly reduce: THREE.ShaderMaterial;
    private readonly dilate: THREE.ShaderMaterial;
    private readonly viewport = new THREE.Vector4();
    private readonly scissor = new THREE.Vector4();
    private readonly color = new THREE.Color();
    private version = -1;
    private builds = 0;
    private disposed = false;
    constructor(renderer: THREE.WebGLRenderer, simulation: SmokeField) {
        this.resolution = simulation.densityResolution / 8;
        this.tiles = Math.ceil(Math.sqrt(this.resolution));
        const width = this.tiles * this.resolution;
        const height = Math.ceil(this.resolution / this.tiles) * this.resolution;
        const options = { format: simulation.texture.format === THREE.RedFormat ? THREE.RedFormat : THREE.RGBAFormat, type: THREE.HalfFloatType,
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
        this.core = new THREE.WebGLRenderTarget(width, height, options);
        this.expanded = new THREE.WebGLRenderTarget(width, height, options);
        this.timer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
        const uniforms = {
            uN: { value: this.resolution }, uTiles: { value: this.tiles },
            uH: { value: simulation.domainSize / this.resolution }, uDomainMin: { value: simulation.domainMin },
            uDensity: { value: simulation.texture }, uCore: { value: this.core.texture },
            uDensityN: { value: simulation.densityResolution }, uDensityTiles: { value: simulation.densityTiles },
        };
        const fragment = `precision highp float;precision highp int;
            uniform sampler2D uDensity,uCore;uniform int uDensityN,uDensityTiles;out vec4 outColor;
            ${smokeGridGLSL}
            void main(){ivec3 c=cellOf();if(!inside(c)){outColor=vec4(0);return;}float maximum=0.0;
            #ifdef REDUCE
                for(int z=0;z<8;z++)for(int y=0;y<8;y++)for(int x=0;x<8;x++)
                    maximum=max(maximum,fetchAt(uDensity,c*8+ivec3(x,y,z),uDensityN,uDensityTiles).r);
            #else
                for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)
                    maximum=max(maximum,fetchField(uCore,c+ivec3(x,y,z)).r);
            #endif
            outColor=vec4(maximum,0,0,1);}`;
        const material = (reduce: boolean) => new THREE.ShaderMaterial({
            uniforms, defines: reduce ? { REDUCE: 1 } : {}, glslVersion: THREE.GLSL3,
            vertexShader: fullscreenVertex, fragmentShader: fragment,
            depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
        });
        this.reduce = material(true);this.dilate = material(false);
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.reduce);
        this.quad.frustumCulled = false;this.scene.add(this.quad);
    }
    get texture(): THREE.Texture { return this.expanded.texture; }
    invalidate(): void { this.version = -1; }
    needsUpdate(simulation: SmokeField): boolean { return this.version !== simulation.version; }
    update(renderer: THREE.WebGLRenderer, camera: THREE.Camera, simulation: SmokeField, measure = false): void {
        if (this.disposed || !this.needsUpdate(simulation)) return;
        const target = renderer.getRenderTarget(), auto = renderer.autoClear, alpha = renderer.getClearAlpha(), test = renderer.getScissorTest();
        renderer.getViewport(this.viewport);renderer.getScissor(this.scissor);renderer.getClearColor(this.color);
        if (measure) this.timer.begin();
        try {
            renderer.autoClear = true;renderer.setScissorTest(false);renderer.setClearColor(0, 0);
            this.reduce.uniforms.uDensity.value = simulation.texture;
            this.quad.material = this.reduce;renderer.setRenderTarget(this.core);renderer.render(this.scene, camera);
            this.quad.material = this.dilate;renderer.setRenderTarget(this.expanded);renderer.render(this.scene, camera);
            this.version = simulation.version;this.builds++;
        } finally {
            if (measure) this.timer.end();
            renderer.setRenderTarget(target);renderer.setViewport(this.viewport);renderer.setScissor(this.scissor);
            renderer.setScissorTest(test);renderer.setClearColor(this.color, alpha);renderer.autoClear = auto;
        }
    }
    getDebugInfo() {
        return { resolution: this.resolution, builds: this.builds, gpu: this.timer.stats(),
            dataBytes: this.core.width * this.core.height * 2 * 2 * (this.core.texture.format === THREE.RedFormat ? 1 : 4) };
    }
    dispose(): void {
        if (this.disposed) return;this.disposed = true;
        this.timer.dispose();this.core.dispose();this.expanded.dispose();this.reduce.dispose();this.dilate.dispose();
        this.quad.geometry.dispose();this.quad.removeFromParent();
    }
}
