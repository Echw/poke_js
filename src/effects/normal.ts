import * as THREE from 'three';
import { CardTransformation, CARD_REVEAL_TIMING as T } from './cardTransformation';
import { makeRibbons } from './ribbonGeometry';
import { normalMaterial } from './normalMaterial';
import type { NormalLayer } from './normalMaterial';
import type { PokemonRevealEffect } from './types';

/** Quiet ivory reveal; the scene retains the clock, light, card pose and renderer. */
export class NormalEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xfff4e7);
    readonly fillLightPosition = new THREE.Vector3(0, -0.035, 0.46);
    readonly transformation: CardTransformation;
    readonly state = { growth: 0, energy: 0, sparks: 0 };
    private readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly worldToCard = new THREE.Matrix4();
    private finished = false;
    private disposed = false;

    get fillLightIntensity(): number {
        const s = this.transformation.state;
        return (s.core * 0.18 + this.state.energy * 0.72) * (1 - s.morph * 0.55) * (1 - s.cardImage) * s.fade;
    }

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'NormalEffect'; this.root.visible = false;
        this.transformation = new CardTransformation(card, 'normal', mobile);
        this.root.add(this.transformation.root);
        const streams = makeRibbons(2, 2, mobile ? 160 : 208, 10);
        const source = makeRibbons(5, 1, mobile ? 48 : 64, 6);
        const orbit = makeRibbons(1, 2, mobile ? 96 : 128, 8);
        const aura = new THREE.PlaneGeometry(1.30, 1.04);
        aura.translate(0, 0.46, 0.58);
        aura.setAttribute('aAura', new THREE.InstancedBufferAttribute(new Float32Array([0, 1]), 1));
        const pool = new THREE.PlaneGeometry(1.18, 1.18);
        pool.rotateX(-Math.PI / 2); pool.translate(0, -0.055, 0.46);
        const dust = new THREE.PlaneGeometry(1, 1), stars = new THREE.PlaneGeometry(1, 1);
        const motes = new THREE.PlaneGeometry(1, 1);
        const dustCount = mobile ? 34 : 46, starCount = 18, moteCount = mobile ? 42 : 62;
        for (const [geometry, count, star] of [[dust, dustCount, false], [stars, starCount, true]] as const) {
            const seeds = new Float32Array(count * 4);
            for (let i = 0; i < count; i++) {
                const seed = (i * 0.6180339 + 0.13) % 1;
                const trail = star && i < 4;
                const birth = trail ? 0.12 + i * 0.61 : 0.02 + (star ? i - 4 : i) * (star ? 0.18 : 2.50 / count);
                seeds.set([birth, i * 2.399963, seed,
                    trail ? 1.65 : star ? 1.12 + seed * 0.55 : 0.95 + seed * 0.85], i * 4);
            }
            geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
        }
        stars.setAttribute('aTrail', new THREE.InstancedBufferAttribute(
            Float32Array.from({ length: starCount }, (_, i) => i < 4 ? 1 : 0), 1));
        const moteSeeds = new Float32Array(moteCount * 4);
        for (let i = 0; i < moteCount; i++) {
            const seed = (i * 0.6180339 + 0.31) % 1;
            moteSeeds.set([0.03 + i * 2.45 / moteCount, i * 2.399963, seed, 0.85 + seed * 0.65], i * 4);
        }
        motes.setAttribute('aSeed', new THREE.InstancedBufferAttribute(moteSeeds, 4));
        this.geometries.push(streams, source, orbit, aura, pool, dust, stars, motes);
        const layers: { kind: NormalLayer; geometry: THREE.BufferGeometry; count?: number }[] = [
            { kind: 'pool', geometry: pool }, { kind: 'aura', geometry: aura, count: 2 },
            { kind: 'source', geometry: source }, { kind: 'orbit', geometry: orbit }, { kind: 'stream', geometry: streams },
            { kind: 'mote', geometry: motes, count: moteCount },
            { kind: 'dust', geometry: dust, count: dustCount }, { kind: 'star', geometry: stars, count: starCount },
        ];
        for (let pass = 0; pass < 2; pass++) {
            for (const [order, { kind, geometry, count }] of layers.entries()) {
                const material = normalMaterial(kind, pass);
                const mesh = count ? new THREE.InstancedMesh(geometry, material, count) : new THREE.Mesh(geometry, material);
                mesh.name = `Normal-${kind}-${pass === 0 ? 'behind' : 'front'}`;
                mesh.frustumCulled = false; mesh.renderOrder = (pass === 0 ? 2.05 : 3.4) + order * 0.02;
                mesh.onBeforeRender = (_renderer, _scene, camera) => {
                    this.worldToCard.copy(card.matrixWorld).invert();
                    material.uniforms.uEffectToCard.value.multiplyMatrices(this.worldToCard, mesh.matrixWorld);
                    material.uniforms.uViewToCard.value.multiplyMatrices(this.worldToCard, camera.matrixWorld);
                    material.uniforms.uCameraCard.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.worldToCard);
                };
                this.meshes.push(mesh); this.root.add(mesh);
            }
        }
    }

    setActive(active: boolean): void {
        if (this.disposed) return;
        this.root.visible = active; this.transformation.setActive(active);
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        timeline.to(this.state, { growth: 0.10, energy: 0.24, sparks: 0.3, duration: 0.30, ease: 'sine.out' }, 0);
        timeline.to(this.state, { growth: 1.06, energy: 1, sparks: 1, duration: 0.78, ease: 'sine.inOut' }, 0.30);
        timeline.to(this.state, { energy: 0.55, duration: T.image - T.morph, ease: 'sine.inOut' }, T.morph);
        timeline.to(this.state, { energy: 0, sparks: 0.28, duration: T.fade - T.image, ease: 'sine.out' }, T.image);
    }

    /** Absolute shader time allows deterministic seek, interruption and replay without allocations. */
    update(time: number, _viewportHeight: number): void {
        if (this.disposed) return;
        const s = this.transformation.state;
        this.transformation.update(time);
        for (const mesh of this.meshes) {
            mesh.visible = !this.finished;
            const u = mesh.material.uniforms, kind = mesh.material.defines;
            u.uTime.value = time; u.uFlowTime.value = time; u.uGrowth.value = this.state.growth;
            u.uMorph.value = s.morph; u.uImage.value = s.cardImage;
            u.uOpacity.value = (kind.STAR || kind.DUST || kind.MOTE ? this.state.sparks : this.state.energy) * s.fade;
            if (kind.POOL) u.uOpacity.value *= (1 - s.morph * 0.65) * (1 - s.cardImage);
            if (kind.SOURCE) u.uOpacity.value *= (1 - s.morph * 0.75) * (1 - s.cardImage);
            if (kind.AURA) u.uOpacity.value *= (1 - s.morph * 0.8) * (1 - s.cardImage);
            if (kind.ORBIT) u.uOpacity.value *= (1 - s.morph * 0.25) * (1 - s.cardImage * 0.85);
        }
    }

    reset(): void {
        if (this.disposed) return;
        this.finished = false; this.transformation.reset();
        Object.assign(this.state, { growth: 0, energy: 0, sparks: 0 }); this.update(0, 800);
    }

    finish(): void {
        this.finished = true; this.transformation.finish();
        this.meshes.forEach(mesh => { mesh.visible = false; });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.transformation.dispose();
        this.meshes.forEach(mesh => {
            if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
            mesh.material.dispose();
        });
        this.geometries.forEach(geometry => geometry.dispose()); this.root.removeFromParent();
    }
}
