import * as THREE from 'three';
import { fullscreenVertex } from './gpuSmokeShaders';

/** Verify actual FP16 interpolation without constructing simulation resources. */
export function probeSmokeFiltering(renderer: THREE.WebGLRenderer): boolean {
    const channels = 1;
    const inputData = new Uint16Array(channels * 2);
    inputData.fill(THREE.DataUtils.toHalfFloat(1), channels);
    const input = new THREE.DataTexture(inputData, 2, 1, THREE.RedFormat, THREE.HalfFloatType);
    input.minFilter = input.magFilter = THREE.LinearFilter; input.generateMipmaps = false; input.needsUpdate = true;
    const output = new THREE.WebGLRenderTarget(2, 1, { depthBuffer: false });
    const material = new THREE.ShaderMaterial({ uniforms: { uInput: { value: input } }, vertexShader: fullscreenVertex,
        fragmentShader: 'uniform sampler2D uInput;void main(){vec2 v=texture2D(uInput,vec2(0.25+gl_FragCoord.x*0.25,0.5)).rg;gl_FragColor=vec4(v,0,1);}',
        toneMapped: false, depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material), scene = new THREE.Scene();
    quad.frustumCulled = false; scene.add(quad);
    const previous = renderer.getRenderTarget(), viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
    const test = renderer.getScissorTest(), auto = renderer.autoClear;
    const data = new Uint8Array(8);
    try {
        renderer.setScissorTest(false); renderer.autoClear = true;
        renderer.setRenderTarget(output); renderer.render(scene, new THREE.Camera());
        renderer.readRenderTargetPixels(output, 0, 0, 2, 1, data);
        return Array.from({ length: channels }, (_, c) => Math.abs(data[c]! / 255 - 0.25) < 0.01 && Math.abs(data[c + 4]! / 255 - 0.75) < 0.01).every(Boolean);
    } finally {
        renderer.setRenderTarget(previous); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(test); renderer.autoClear = auto;
        input.dispose(); output.dispose(); material.dispose(); quad.geometry.dispose();
    }
}
