import * as THREE from 'three';
import { CardTransformation, CARD_REVEAL_TIMING as T } from './cardTransformation';
import { makeRibbons } from './ribbonGeometry';
import { fairyMaterial, FAIRY_FLARES } from './fairyMaterial';
import type { FairyLayer } from './fairyMaterial';
import type { PokemonRevealEffect } from './types';

/** Fairy spell uses the scene's existing clock, card pose, fill light and renderer. */
export class FairyEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xff6eae);
    readonly fillLightPosition = new THREE.Vector3(0, 0.01, 0.67);
    readonly transformation: CardTransformation;
    readonly state = { growth: 0, energy: 0, sparks: 0 };
    private readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly worldToCard = new THREE.Matrix4();
    private finished = false;
    private disposed = false;

    get fillLightIntensity(): number {
        const s = this.transformation.state;
        return (s.core * 0.28 + this.state.energy * 1.65) * (1 - s.morph * 0.60) * (1 - s.cardImage) * s.fade;
    }

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'FairyEffect';
        this.root.visible = false;
        this.transformation = new CardTransformation(card, 'fairy', mobile);
        this.root.add(this.transformation.root);
        const streams = makeRibbons(2, 3, mobile ? 112 : 168, 8);
        const orbits = makeRibbons(2, 2, mobile ? 80 : 112, 6);
        const pool = new THREE.PlaneGeometry(1.36, 1.36);
        pool.rotateX(-Math.PI / 2); pool.translate(0, -0.055, 0.46);
        const flares = new THREE.PlaneGeometry(1, 1);
        const sparks = new THREE.PlaneGeometry(1, 1, 10, 2);
        const stars = new THREE.PlaneGeometry(1, 1);
        const petals = new THREE.PlaneGeometry(1, 1, 10, 16);
        const dust = new THREE.PlaneGeometry(1, 1);
        const sparkCount = mobile ? 38 : 54, dustCount = mobile ? 64 : 96;
        const sparkEvents = new Float32Array(sparkCount * 4), launches = new Float32Array(sparkCount * 3);
        for (let i = 0; i < sparkCount; i++) {
            const seed = (i * 0.6180339) % 1, birth = 0.08 + i * (2.55 / sparkCount);
            // First sparks leave the source; later events detach at the same bends as the flares.
            const flare = FAIRY_FLARES[i % 3];
            const height = i < 8 ? 0.025 : Math.min(flare.from + seed * 0.18, Math.max(0.04, (birth - 0.2) * 0.80));
            sparkEvents.set([birth, 1.0 + seed * 0.45, i < 8 ? i % 2 : flare.band, height], i * 4);
            launches.set([(i % 2 ? 1 : -1) * (1.45 + seed * 1.25) * (mobile ? 0.86 : 1),
                0.18 + seed * 0.38, (seed - 0.5) * 0.30], i * 3);
        }
        const petalSeeds = new Float32Array(6 * 4), dustSeeds = new Float32Array(dustCount * 4);
        for (let i = 0; i < 6; i++) petalSeeds.set([0.05 + i * 0.17, 1.0 + i * 2.399963, (i * 0.6180339) % 1, 2.70 + (i % 3) * 0.22], i * 4);
        for (let i = 0; i < dustCount; i++) dustSeeds.set([0.05 + (i % 13) * 0.065, i * 2.399963, (i * 0.6180339) % 0.94, 2.25 + (i % 5) * 0.16], i * 4);
        flares.setAttribute('aFlare', new THREE.InstancedBufferAttribute(Float32Array.from(FAIRY_FLARES, (_, i) => i), 1));
        sparks.setAttribute('aEvent', new THREE.InstancedBufferAttribute(sparkEvents, 4));
        sparks.setAttribute('aLaunch', new THREE.InstancedBufferAttribute(launches, 3));
        stars.setAttribute('aEvent', sparks.getAttribute('aEvent')); stars.setAttribute('aLaunch', sparks.getAttribute('aLaunch'));
        petals.setAttribute('aSeed', new THREE.InstancedBufferAttribute(petalSeeds, 4));
        dust.setAttribute('aSeed', new THREE.InstancedBufferAttribute(dustSeeds, 4));
        this.geometries.push(streams, orbits, pool, flares, sparks, stars, petals, dust);
        const layers: { kind: FairyLayer; geometry: THREE.BufferGeometry; count?: number }[] = [
            { kind: 'pool', geometry: pool }, { kind: 'stream', geometry: streams },
            { kind: 'orbit', geometry: orbits },
            { kind: 'dust', geometry: dust, count: dustCount },
            { kind: 'petal', geometry: petals, count: 6 },
            { kind: 'flare', geometry: flares, count: FAIRY_FLARES.length },
            { kind: 'spark', geometry: sparks, count: sparkCount }, { kind: 'star', geometry: stars, count: sparkCount },
        ];
        for (let pass = 0; pass < 2; pass++) {
            for (const [order, { kind, geometry, count }] of layers.entries()) {
                const material = fairyMaterial(kind, pass);
                const mesh = count ? new THREE.InstancedMesh(geometry, material, count) : new THREE.Mesh(geometry, material);
                mesh.name = `Fairy-${kind}-${pass === 0 ? 'behind' : 'front'}`;
                mesh.frustumCulled = false;
                mesh.renderOrder = (pass === 0 ? 2.05 : 3.4) + order * 0.02;
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
        this.root.visible = active;
        this.transformation.setActive(active);
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        timeline.to(this.state, { growth: 0.12, energy: 0.22, sparks: 0.35, duration: 0.32, ease: 'sine.out' }, 0);
        timeline.to(this.state, { growth: 1, energy: 1, sparks: 1, duration: 0.80, ease: 'sine.inOut' }, 0.32);
        timeline.to(this.state, { energy: 0.55, duration: T.image - T.morph, ease: 'sine.inOut' }, T.morph);
        timeline.to(this.state, { energy: 0.12, sparks: 0.24, duration: T.fade - T.image, ease: 'sine.out' }, T.image);
    }

    /** Absolute-time GPU paths remain deterministic across interruption, seek and replay. */
    update(time: number, _viewportHeight: number): void {
        if (this.disposed) return;
        this.transformation.update(time);
        const s = this.transformation.state;
        for (const mesh of this.meshes) {
            mesh.visible = !this.finished;
            const u = mesh.material.uniforms, d = mesh.material.defines;
            u.uTime.value = time; u.uGrowth.value = this.state.growth;
            u.uMorph.value = s.morph; u.uImage.value = s.cardImage;
            u.uSourceLight.value = (s.core * 0.35 + this.state.energy * 1.8) * (1 - s.morph * 0.5) * (1 - s.cardImage * 0.8);
            u.uOpacity.value = (d.PETAL ? s.core : d.SPARK || d.STAR || d.DUST ? this.state.sparks : this.state.energy) * s.fade;
            if (d.POOL) u.uOpacity.value *= (1 - s.morph * 0.7) * (1 - s.cardImage);
            if (d.ORBIT) u.uOpacity.value *= (1 - s.cardImage * 0.75) * 0.85;
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
