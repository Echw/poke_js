import * as THREE from 'three';
import { CardTransformation, CARD_REVEAL_TIMING as T } from './cardTransformation';
import { makeRibbons } from './ribbonGeometry';
import { dragonMaterial, DRAGON_FLARES } from './dragonMaterial';
import type { DragonLayer } from './dragonMaterial';
import type { PokemonRevealEffect } from './types';

/** Compact spell; the scene retains its single clock, card pose, light and renderer. */
export class DragonEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0x344aff);
    readonly fillLightPosition = new THREE.Vector3(0, 0.04, 1.10);
    readonly transformation: CardTransformation;
    readonly state = { growth: 0, energy: 0, sparks: 0 };
    private readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly worldToCard = new THREE.Matrix4();
    private finished = false;
    private disposed = false;

    get fillLightIntensity(): number {
        const s = this.transformation.state;
        return (s.core * 0.6 + this.state.energy * 3.0) * (1-s.morph*0.72) * (1-s.cardImage) * s.fade;
    }

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'DragonEffect';
        this.root.visible = false;
        this.transformation = new CardTransformation(card, 'dragon', mobile);
        this.root.add(this.transformation.root);
        const streams = makeRibbons(3, 3, mobile ? 128 : 192, 12);
        const pool = new THREE.PlaneGeometry(1.50, 1.50, 1, 1);
        pool.rotateX(-Math.PI/2);
        pool.translate(0, -0.055, 0.46);
        const flares = new THREE.PlaneGeometry(1, 1);
        const sparks = new THREE.PlaneGeometry(1, 1, 12, 2);
        const wisps = new THREE.PlaneGeometry(1, 1);
        const stars = new THREE.PlaneGeometry(1, 1);
        const sparkCount = mobile ? 48 : 64;
        const wispCount = mobile ? 9 : 14;
        const sparkEvents = new Float32Array(sparkCount * 4);
        const launches = new Float32Array(sparkCount * 3);
        const mistSeeds = new Float32Array(wispCount * 4);
        const mistBands = new Float32Array(wispCount);
        const bends = [
            { band: 0, height: 0.56, side: -1 },
            { band: 1, height: 0.49, side: 1 },
            { band: 0, height: 0.86, side: 1 },
        ];
        for (let i = 0; i < sparkCount; i++) {
            const birth = 0.16 + i * (mobile ? 0.055 : 0.041);
            const bend = bends[i % bends.length];
            const seed = (i * 0.6180339) % 1;
            const height = i < 6 ? 0.035 : Math.min(bend.height + (seed - 0.5) * 0.07, (birth - 0.15) * 1.12);
            sparkEvents.set([birth, 0.65 + (i % 4) * 0.07, bend.band, height], i * 4);
            launches.set([bend.side * (1.3 + seed * 0.9) * (mobile ? 0.66 : 1),
                0.20 + Math.sin(i * 2.4) * 1.0, 0.15 + seed * 0.18], i * 3);
        }
        for (let i = 0; i < wispCount; i++) {
            mistSeeds.set([(i * 0.6180339) % 1, i * 2.399963, 0.10 + (i % 3) * 0.025,
                0.35 + (i % 5) * 0.04], i * 4);
            mistBands[i] = i % 4 === 0 ? 2 : 1;
        }
        flares.setAttribute('aFlare', new THREE.InstancedBufferAttribute(Float32Array.from(DRAGON_FLARES, (_, i) => i), 1));
        sparks.setAttribute('aEvent', new THREE.InstancedBufferAttribute(sparkEvents, 4));
        sparks.setAttribute('aLaunch', new THREE.InstancedBufferAttribute(launches, 3));
        stars.setAttribute('aEvent', sparks.getAttribute('aEvent'));
        stars.setAttribute('aLaunch', sparks.getAttribute('aLaunch'));
        wisps.setAttribute('aMist', new THREE.InstancedBufferAttribute(mistSeeds, 4));
        wisps.setAttribute('aMistBand', new THREE.InstancedBufferAttribute(mistBands, 1));
        this.geometries.push(streams, flares, sparks, pool, wisps, stars);
        const layers: { kind: DragonLayer; geometry: THREE.BufferGeometry; count?: number }[] = [
            { kind: 'pool', geometry: pool },
            { kind: 'wisp', geometry: wisps, count: wispCount },
            { kind: 'stream', geometry: streams },
            { kind: 'flare', geometry: flares, count: DRAGON_FLARES.length },
            { kind: 'spark', geometry: sparks, count: sparkCount },
            { kind: 'star', geometry: stars, count: sparkCount },
        ];
        for (let pass = 0; pass < 2; pass++) {
            for (const [order, { kind, geometry, count }] of layers.entries()) {
                const material = dragonMaterial(kind, pass);
                const mesh = count ? new THREE.InstancedMesh(geometry, material, count) : new THREE.Mesh(geometry, material);
                mesh.name = `Dragon-${kind}-${pass === 0 ? 'behind' : 'front'}`;
                mesh.frustumCulled = false;
                mesh.renderOrder = (pass === 0 ? 2.05 : 3.4) + order * 0.02;
                mesh.onBeforeRender = (_renderer, _scene, camera) => {
                    this.worldToCard.copy(card.matrixWorld).invert();
                    material.uniforms.uEffectToCard.value.multiplyMatrices(this.worldToCard, mesh.matrixWorld);
                    material.uniforms.uViewToCard.value.multiplyMatrices(this.worldToCard, camera.matrixWorld);
                    material.uniforms.uCameraCard.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.worldToCard);
                };
                this.meshes.push(mesh);
                this.root.add(mesh);
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
        timeline.to(this.state, { growth: 0.18, energy: 0.22, sparks: 0.35, duration: 0.32, ease: 'power1.out' }, 0);
        timeline.to(this.state, { growth: 1, energy: 1, sparks: 1, duration: 0.66, ease: 'power1.inOut' }, 0.32);
        timeline.to(this.state, { energy: 0.60, duration: T.image-T.morph, ease: 'power1.inOut' }, T.morph);
        timeline.to(this.state, { energy: 0.18, sparks: 0.32, duration: T.fade-T.image, ease: 'power1.out' }, T.image);
    }

    /** Absolute-time GPU trajectories support seek, interruption and replay without a particle loop. */
    update(time: number, _viewportHeight: number): void {
        if (this.disposed) return;
        this.transformation.update(time);
        const s = this.transformation.state;
        for (const mesh of this.meshes) {
            mesh.visible = !this.finished;
            const u = mesh.material.uniforms;
            u.uTime.value = time;
            u.uGrowth.value = this.state.growth;
            u.uMorph.value = s.morph;
            u.uImage.value = s.cardImage;
            u.uOpacity.value = (mesh.material.defines.SPARK || mesh.material.defines.STAR ? this.state.sparks : this.state.energy) * s.fade;
            if (mesh.material.defines.POOL) u.uOpacity.value *= (1-s.morph*0.6)*(1-s.cardImage);
            if (mesh.material.defines.WISP) u.uOpacity.value *= 1-s.morph*0.55;
        }
    }

    reset(): void {
        if (this.disposed) return;
        this.finished = false;
        this.transformation.reset();
        Object.assign(this.state, { growth: 0, energy: 0, sparks: 0 });
        this.update(0, 800);
    }

    finish(): void {
        this.finished = true;
        this.transformation.finish();
        this.meshes.forEach(mesh => { mesh.visible = false; });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.transformation.dispose();
        this.meshes.forEach(mesh => mesh.material.dispose());
        this.geometries.forEach(geometry => geometry.dispose());
        this.root.removeFromParent();
    }
}
