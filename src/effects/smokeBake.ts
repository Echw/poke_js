import * as THREE from 'three';
import { GpuSmokeSimulation } from './gpuSmokeSimulation';
import { fullscreenVertex, smokeGridGLSL } from './gpuSmokeShaders';

/** Explicit offline readback only; never constructed by normal replay. */
export class SmokeBaker {
    private target: THREE.WebGLRenderTarget;
    private scene = new THREE.Scene();
    private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private pixels: Float32Array;
    private renderer: THREE.WebGLRenderer;
    private camera: THREE.Camera;
    private simulation: GpuSmokeSimulation;
    constructor(renderer: THREE.WebGLRenderer, camera: THREE.Camera, simulation: GpuSmokeSimulation) {
        this.renderer = renderer; this.camera = camera; this.simulation = simulation;
        const n = simulation.densityResolution, tiles = simulation.densityTiles;
        const width = n * tiles, height = n * Math.ceil(n / tiles);
        this.target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.FloatType,
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
        this.pixels = new Float32Array(width * height * 4);
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3, vertexShader: fullscreenVertex,
            uniforms: { uN: { value: n }, uTiles: { value: tiles }, uH: { value: simulation.domainSize / n },
                uDomainMin: { value: simulation.domainMin }, uBoundsMin: { value: simulation.domainMin },
                uBoundsMax: { value: simulation.domainMin.clone().addScalar(simulation.domainSize) },
                uField: { value: simulation.texture } },
            fragmentShader: `precision highp float;precision highp int;
                uniform sampler2D uField;out vec4 outColor;
                ${smokeGridGLSL}
                void main(){ivec3 c=cellOf();if(!inside(c)){outColor=vec4(0);return;}
                    float d=fetchField(uField,c).r;
                    outColor=vec4(d,0,0,1);}`,
            depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
        }));
        this.quad.frustumCulled = false; this.scene.add(this.quad);
    }
    exportFrame(frame: number): Uint16Array {
        if (!Number.isInteger(frame) || frame < 0 || frame > 360) throw new Error('Invalid bake frame');
        this.simulation.advanceTo(frame / 60);
        this.quad.material.uniforms.uField!.value = this.simulation.texture;
        const previous = this.renderer.getRenderTarget();
        try {
            this.renderer.setRenderTarget(this.target); this.renderer.render(this.scene, this.camera);
            this.renderer.readRenderTargetPixels(this.target, 0, 0, this.target.width, this.target.height, this.pixels);
        } finally { this.renderer.setRenderTarget(previous); }
        const packed = new Uint16Array(this.target.width * this.target.height);
        for (let i = 0; i < packed.length; i++) packed[i] = THREE.DataUtils.toHalfFloat(this.pixels[i * 4]!);
        return packed;
    }
    dispose(): void {
        this.target.dispose(); this.quad.geometry.dispose(); this.quad.material.dispose();
        this.quad.removeFromParent(); this.pixels = new Float32Array(0);
    }
}

/** Lazy QA-only GPU readback of the atlas red channel, including padding texels. */
export class SmokeFieldReadback {
    private renderer: THREE.WebGLRenderer;
    private target: THREE.WebGLRenderTarget;
    private pixels: Float32Array;
    private scene = new THREE.Scene();
    private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
        this.renderer = renderer;
        this.target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.FloatType, depthBuffer: false });
        this.pixels = new Float32Array(width * height * 4);
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
            uniforms: { uInput: { value: null } }, glslVersion: THREE.GLSL3, vertexShader: fullscreenVertex,
            fragmentShader: 'precision highp float;uniform sampler2D uInput;out vec4 outColor;void main(){outColor=vec4(texelFetch(uInput,ivec2(gl_FragCoord.xy),0).r,0,0,1);}',
            blending: THREE.NoBlending, depthTest: false, depthWrite: false, toneMapped: false,
        }));
        this.quad.frustumCulled = false; this.scene.add(this.quad);
    }
    read(texture: THREE.Texture): Uint16Array {
        this.quad.material.uniforms.uInput!.value = texture;
        const previous = this.renderer.getRenderTarget();
        try {
            this.renderer.setRenderTarget(this.target); this.renderer.render(this.scene, new THREE.Camera());
            this.renderer.readRenderTargetPixels(this.target, 0, 0, this.target.width, this.target.height, this.pixels);
        } finally { this.renderer.setRenderTarget(previous); }
        const data = new Uint16Array(this.target.width * this.target.height);
        for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(this.pixels[i * 4]!);
        return data;
    }
    dispose(): void { this.target.dispose(); this.quad.geometry.dispose(); this.quad.material.dispose(); this.pixels = new Float32Array(0); }
}
