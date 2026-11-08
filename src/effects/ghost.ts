import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import { createGhostRibbonMaterial } from './ghostRibbonMaterial';
import { makeRibbons } from './ribbonGeometry';
import type { PokemonRevealEffect } from './types';

/** The host's smoke volume owns Ghost matter; this effect owns its shared card source. */
export class GhostEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0x9951d2);
    readonly fillLightPosition = new THREE.Vector3(0, -0.03, 0.28);
    readonly transformation: CardTransformation;
    private readonly ribbons: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private time = 0;
    private disposed = false;

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'GhostEffect';
        this.transformation = new CardTransformation(card, 'ghost', mobile);
        this.root.add(this.transformation.root);
        this.ribbons = new THREE.Mesh(makeRibbons(mobile ? 3 : 4, 1, mobile ? 96 : 144, 6), createGhostRibbonMaterial());
        this.ribbons.name = 'GhostLightRibbons';
        this.ribbons.frustumCulled = false;
        this.ribbons.visible = false;
        this.root.add(this.ribbons);
        this.setActive(false);
    }
    get fillLightIntensity(): number {
        return THREE.MathUtils.smoothstep(this.time, 0.05, 0.65)
            * (1 - THREE.MathUtils.smoothstep(this.time, 1.65, 3.5) * 0.98) * 4.2;
    }
    get cardDepthVisible(): boolean { return this.time >= 2.15; }
    get fogDepthRevision(): string { return String(this.time); }
    withFogDepth<T>(render: () => T): T {
        const visible = this.root.visible;
        this.root.visible = false;
        try { return render(); } finally { this.root.visible = visible; }
    }
    async compileFogDepth(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
        this.ribbons.visible = true;
        try { await renderer.compileAsync(this.ribbons, camera, scene); }
        finally { this.ribbons.visible = false; }
        await this.withFogDepth(() => renderer.compileAsync(this.root, camera, scene));
    }
    /** One additive draw after fog, using the existing Ball/card depth and renderer. */
    renderRibbons(renderer: THREE.WebGLRenderer, camera: THREE.Camera, depth: THREE.Texture): void {
        if (this.disposed || !this.root.visible || !this.ribbons.material.visible
            || this.ribbons.material.uniforms.uOpacity.value <= 0.001) return;
        const uniforms = this.ribbons.material.uniforms;
        uniforms.uSceneDepth.value = depth;
        renderer.getDrawingBufferSize(uniforms.uResolution.value);
        this.ribbons.updateWorldMatrix(true, false);
        const autoClear = renderer.autoClear;
        try {
            this.ribbons.visible = true;
            renderer.autoClear = false;
            renderer.render(this.ribbons, camera);
        } finally {
            this.ribbons.visible = false;
            renderer.autoClear = autoClear;
        }
    }
    setActive(active: boolean): void {
        if (this.disposed) return;
        this.root.visible = active;
        this.transformation.setActive(active);
    }
    addToTimeline(timeline: gsap.core.Timeline): void { this.transformation.addToTimeline(timeline); }
    update(time: number, _viewportHeight: number): void {
        if (this.disposed) return;
        this.time = time;
        this.transformation.update(time);
        const uniforms = this.ribbons.material.uniforms;
        uniforms.uTime.value = time;
        uniforms.uReveal.value = THREE.MathUtils.smoothstep(time, 0.20, 0.80);
        uniforms.uOpacity.value = THREE.MathUtils.smoothstep(time, 0.20, 0.80)
            * (1 - THREE.MathUtils.smoothstep(time, 2.15, 2.85)) * 1.40;
    }
    reset(): void {
        if (this.disposed) return;
        this.time = 0;
        this.transformation.reset();
        this.update(0, 800);
    }
    finish(): void {
        this.time = 3.5;
        this.ribbons.material.uniforms.uOpacity.value = 0;
        this.transformation.finish();
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        this.transformation.dispose();
        this.ribbons.geometry.dispose();
        this.ribbons.material.dispose();
    }
}
