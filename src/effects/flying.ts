import * as THREE from 'three';
import { CardTransformation, CARD_REVEAL_TIMING as T } from './cardTransformation';
import { flyingMaterial } from './flyingMaterial';
import { makeRibbons } from './ribbonGeometry';
import type { PokemonRevealEffect } from './types';

/** A small generated atlas-free feather, drawn once and shared by every instance. */
function makeFeatherTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Flying feather canvas unavailable');
    const contour = new Path2D();
    contour.moveTo(57, 231);
    contour.bezierCurveTo(12, 193, 24, 82, 86, 13);
    contour.bezierCurveTo(98, 87, 111, 159, 57, 231);
    const gradient = context.createLinearGradient(20, 100, 105, 132);
    gradient.addColorStop(0, '#819ac4');
    gradient.addColorStop(0.45, '#f3f6ff');
    gradient.addColorStop(1, '#b7c9e5');
    context.fillStyle = gradient;
    context.fill(contour);
    context.save();
    context.clip(contour);
    for (let y = 35; y < 226; y += 7) {
        const x = 58 + (230-y) * 0.12;
        context.beginPath();
        context.moveTo(x, y+12);
        context.quadraticCurveTo(x-20, y+5, 12, y-24);
        context.moveTo(x, y+12);
        context.quadraticCurveTo(x+22, y-3, 115, y-25);
        context.strokeStyle = y % 3 ? 'rgba(255,255,255,0.72)' : 'rgba(73,105,152,0.48)';
        context.lineWidth = 1.3;
        context.stroke();
    }
    // Open small gaps between barbs; a feather should not read as a smooth leaf.
    context.globalCompositeOperation = 'destination-out';
    for (let y = 42; y < 226; y += 13) {
        const x = 58 + (230-y)*0.12;
        context.beginPath();
        context.moveTo(12, y-24);
        context.quadraticCurveTo(x-14, y+2, x-5, y+10);
        context.moveTo(115, y-25);
        context.quadraticCurveTo(x+15, y-1, x+5, y+9);
        context.lineWidth = 2.0;
        context.strokeStyle = 'black';
        context.stroke();
    }
    context.restore();
    context.beginPath();
    context.moveTo(55, 248);
    context.bezierCurveTo(58, 188, 68, 96, 86, 14);
    context.strokeStyle = '#eff7ff';
    context.lineWidth = 2.2;
    context.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

type WindMesh = THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;

/** Ball-local wind; the host owns the sole timeline, card pose and animation loop. */
export class FlyingEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0x85b9ff);
    readonly fillLightPosition = new THREE.Vector3(0, -0.03, 0.38);
    readonly transformation: CardTransformation;
    readonly state = { growth: 0, wind: 0, feathers: 0 };
    private readonly meshes: WindMesh[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly featherTexture = makeFeatherTexture();
    private readonly card: THREE.Mesh;
    private readonly worldToCard = new THREE.Matrix4();
    private readonly featherCount: number;
    private readonly bands: number;
    private finished = false;
    private disposed = false;
    private feathersEnabled = true;

    get fillLightIntensity(): number {
        const s = this.transformation.state;
        return (s.core * 0.9 + s.energy * 0.9) * (1-s.morph*0.8) * (1-s.cardImage) * s.fade;
    }

    constructor(card: THREE.Mesh, mobile = false) {
        this.card = card;
        this.bands = mobile ? 2 : 3;
        this.featherCount = mobile ? 4 : 6;
        this.root.name = 'FlyingEffect';
        this.root.visible = false;
        this.transformation = new CardTransformation(card, 'flying', mobile);
        this.root.add(this.transformation.root);

        const body = new THREE.PlaneGeometry(1, 1, mobile ? 40 : 64, mobile ? 48 : 72);
        const ribbons = makeRibbons(this.bands, 2, mobile ? 96 : 144, 4);
        const feather = new THREE.PlaneGeometry(0.14, 0.28, 2, 8);
        const flights = new Float32Array(this.featherCount * 4);
        for (let i = 0; i < this.featherCount; i++) {
            const last = i === this.featherCount-1;
            flights.set([last ? 1.02 : 0.06+i*0.19, last ? 2.43 : 1.65+i*0.10,
                i*2.39996323+0.8, (i*0.6180339)%1], i*4);
        }
        feather.setAttribute('aFlight', new THREE.InstancedBufferAttribute(flights, 4));
        this.geometries.push(body, ribbons, feather);
        // The passes share geometry. Each fragment belongs to exactly one pass,
        // selected by intersection with the actual moving card, never a fixed z cut.
        for (let pass = 0; pass < 2; pass++) {
            this.addMesh(body, 'body', pass);
            this.addMesh(ribbons, 'ribbon', pass);
            this.addMesh(feather, 'feather', pass);
        }
    }

    private addMesh(geometry: THREE.BufferGeometry, kind: 'body' | 'ribbon' | 'feather', pass: number): void {
        const material = flyingMaterial(kind, this.bands, pass, this.featherTexture);
        const mesh = kind === 'feather'
            ? new THREE.InstancedMesh(geometry, material, this.featherCount)
            : new THREE.Mesh(geometry, material);
        mesh.name = `Flying-${kind}-${pass === 0 ? 'behind' : 'front'}`;
        mesh.frustumCulled = false;
        mesh.renderOrder = (pass === 0 ? 2 : 3.5) + (kind === 'ribbon' ? 0.02 : kind === 'feather' ? 0.04 : 0);
        mesh.onBeforeRender = (_renderer, _scene, camera) => {
            this.worldToCard.copy(this.card.matrixWorld).invert();
            material.uniforms.uWindToCard.value.multiplyMatrices(this.worldToCard, mesh.matrixWorld);
            material.uniforms.uCameraCard.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.worldToCard);
        };
        this.meshes.push(mesh);
        this.root.add(mesh);
    }

    setActive(active: boolean): void {
        if (this.disposed) return;
        this.root.visible = active;
        this.transformation.setActive(active);
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        timeline.to(this.state, { growth: 0.25, wind: 0.35, feathers: 1, duration: 0.4, ease: 'power1.out' }, 0);
        timeline.to(this.state, { growth: 1, wind: 1, duration: 0.4, ease: 'power1.inOut' }, 0.4);
        timeline.to(this.state, { wind: 0.55, duration: T.image-T.morph, ease: 'power1.inOut' }, T.morph);
        timeline.to(this.state, { wind: 0.22, duration: T.fade-T.image, ease: 'power1.out' }, T.image);
    }

    /** Absolute time makes rewind/restart deterministic, with no per-frame allocation. */
    update(time: number, _viewportHeight: number): void {
        if (this.disposed) return;
        this.transformation.update(time);
        const s = this.transformation.state;
        for (const mesh of this.meshes) {
            const feather = Boolean(mesh.material.defines.FEATHER);
            mesh.visible = !this.finished && (!feather || this.feathersEnabled);
            const u = mesh.material.uniforms;
            u.uTime.value = time;
            u.uGrowth.value = this.state.growth;
            u.uOpacity.value = feather ? this.state.feathers * s.fade : this.state.wind * s.fade;
            u.uMorph.value = s.morph;
            u.uImage.value = s.cardImage;
        }
    }

    /** Development-only host control for the required wind-without-feathers check. */
    setFeathersVisible(visible: boolean): void { this.feathersEnabled = visible; }

    getDebugInfo() {
        return { bands: this.bands, feathers: this.featherCount, growth: this.state.growth,
            wind: this.state.wind, finished: this.finished, disposed: this.disposed,
            visibleDraws: this.meshes.filter(mesh => mesh.visible && this.root.visible).length };
    }

    reset(): void {
        if (this.disposed) return;
        this.finished = false;
        this.transformation.reset();
        Object.assign(this.state, { growth: 0, wind: 0, feathers: 0 });
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
        this.root.removeFromParent();
        this.transformation.dispose();
        this.meshes.forEach(mesh => mesh.material.dispose());
        this.geometries.forEach(geometry => geometry.dispose());
        this.featherTexture.dispose();
    }
}
