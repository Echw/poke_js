import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import { createDarkMaterials, createDarkMotes } from './darkMaterial';
import { makeRibbons } from './ribbonGeometry';
import type { PokemonRevealEffect } from './types';

/** Model-local shadow currents; the existing scene owns the timeline, light and renderer. */
export class DarkEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xe80035);
    readonly fillLightPosition = new THREE.Vector3(0, -0.28, 0.50);
    readonly transformation: CardTransformation;
    private readonly geometry: THREE.BufferGeometry;
    private readonly materials = createDarkMaterials();
    private readonly motes: ReturnType<typeof createDarkMotes>;
    private time = 0;
    private disposed = false;

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'DarkEffect';
        this.transformation = new CardTransformation(card, 'dark', mobile);
        this.materials[0].uniforms.uSpread.value = mobile ? 0.75 : 1;
        this.geometry = makeRibbons(6, 2, mobile ? 80 : 128, 8);
        this.materials.forEach((material, index) => {
            const mesh = new THREE.Mesh(this.geometry, material);
            mesh.name = index === 0 ? 'DarkShadowCurrents' : 'DarkCrimsonEdges';
            mesh.renderOrder = 1 + index; mesh.frustumCulled = false;
            this.root.add(mesh);
        });
        this.motes = createDarkMotes(mobile);
        this.root.add(this.transformation.root, this.motes);
        this.setActive(false);
    }

    get fillLightIntensity(): number {
        return THREE.MathUtils.smoothstep(this.time, 0, 0.55)
            * (1 - THREE.MathUtils.smoothstep(this.time, 1.45, 3.5))
            * (4.2 + Math.sin(this.time * 3.4) * 0.30);
    }
    setActive(active: boolean): void {
        if (this.disposed) return;
        this.root.visible = active;
        this.transformation.setActive(active);
    }
    addToTimeline(timeline: gsap.core.Timeline): void { this.transformation.addToTimeline(timeline); }
    update(time: number, viewportHeight: number): void {
        if (this.disposed) return;
        this.time = time;
        this.transformation.update(time);
        const uniforms = this.materials[0].uniforms;
        uniforms.uTime.value = time;
        uniforms.uReveal.value = 0.10 + THREE.MathUtils.smoothstep(time, 0.12, 1.12) * 0.90;
        uniforms.uRetreat.value = THREE.MathUtils.smoothstep(time, 1.8, 2.65);
        uniforms.uOpacity.value = THREE.MathUtils.smoothstep(time, 0.05, 0.8)
            * (1 - THREE.MathUtils.smoothstep(time, 1.8, 3.5));
        this.motes.material.uniforms.uTime.value = time;
        this.motes.material.uniforms.uHeight.value = viewportHeight;
        this.motes.material.uniforms.uOpacity.value = 1 - THREE.MathUtils.smoothstep(time, 2.9, 3.5);
    }
    reset(): void {
        if (this.disposed) return;
        this.transformation.reset(); this.update(0, 800);
    }
    finish(): void {
        if (this.disposed) return;
        this.update(3.5, 800); this.transformation.finish();
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent(); this.transformation.dispose();
        this.geometry.dispose(); this.materials.forEach(material => material.dispose());
        this.motes.geometry.dispose(); this.motes.material.dispose();
    }
}
