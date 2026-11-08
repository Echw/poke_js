import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import { createEarthGeometry } from './fightingMaterial';
import { earthPosition, earthRotation } from './earthMotion';
import { createGroundMaterial, createGroundPillar } from './groundMaterial';
import { GROUND_EVENTS, GROUND_FLOOR, GROUND_GRAVITY, GROUND_PILLARS, groundExtension, groundSmooth } from './groundEvents';
import type { PokemonRevealEffect } from './types';

type Debris = { variant: number; instance: number; birth: number; base: THREE.Vector3; velocity: THREE.Vector3;
    rotation: THREE.Quaternion; axis: THREE.Vector3; spin: number; scale: THREE.Vector3 };

/** Native effect reuses the host clock, Ice's clipped translation and Fighting's rigid debris. */
export class GroundEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xffad46);
    readonly fillLightPosition = new THREE.Vector3(0, -0.035, 0.3);
    readonly transformation: CardTransformation;
    private readonly floor = new THREE.Plane();
    private readonly localFloor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_FLOOR);
    private readonly soil = createGroundMaterial(this.floor);
    private readonly material = this.soil.material;
    readonly ready = this.soil.ready;
    private readonly depth = new THREE.MeshDepthMaterial({ clippingPlanes: [this.floor], colorWrite: false });
    private readonly pillars: THREE.Mesh[] = [];
    private readonly axes: THREE.Vector3[] = [];
    private readonly rubble: THREE.InstancedMesh[] = [];
    private readonly debris: THREE.InstancedMesh[] = [];
    private readonly fragments: Debris[] = [];
    private readonly dummy = new THREE.Object3D();
    private readonly spin = new THREE.Quaternion();
    private readonly geometries: THREE.BufferGeometry[] = [];
    private time = 0;
    private finished = false;
    private disposed = false;
    private live = 0;

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'GroundEffect';
        this.transformation = new CardTransformation(card, 'ground', mobile);
        this.root.add(this.transformation.root);
        GROUND_PILLARS.forEach((p, i) => {
            const geometry = createGroundPillar(i);
            this.geometries.push(geometry);
            const mesh = new THREE.Mesh(geometry, this.material);
            mesh.name = `GroundPillar${i}`;
            const axis = new THREE.Vector3(p.lean, 1, p.leanZ).normalize();
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
            mesh.rotateY(p.yaw);
            mesh.scale.set(p.width * 1.16, p.height, p.width * (1.02 + i % 2 * 0.12));
            this.axes.push(axis); this.pillars.push(mesh); this.root.add(mesh);
        });
        const earth = Array.from({ length: 6 }, (_, i) => createEarthGeometry(i));
        this.geometries.push(...earth);
        // A broken foreground arc follows the inner Ball rim, leaving space around the card.
        // x, z, height, width, depth, yaw; these reuse the six existing rubble instances.
        const low = [[-0.47,0.72,0.22,0.20,0.14,-0.35],[-0.65,0.55,0.12,0.15,0.12,0.6],[-0.22,0.87,0.075,0.13,0.09,-0.2],
            [0.48,0.71,0.17,0.22,0.15,0.4],[0.66,0.54,0.13,0.16,0.12,-0.5],[0.22,0.85,0.09,0.12,0.10,0.3]];
        low.forEach(([x,z,height,width,depth,yaw], i) => {
            const mesh = new THREE.InstancedMesh(earth[i], this.material, 1);
            mesh.name = `GroundRubble${i}`;
            this.dummy.position.set(x, GROUND_FLOOR + height * 0.4, z);
            this.dummy.rotation.set(0.12, yaw, i % 2 ? -0.16 : 0.18);
            this.dummy.scale.set(width, height, depth); this.dummy.updateMatrix();
            mesh.setMatrixAt(0, this.dummy.matrix); this.rubble.push(mesh); this.root.add(mesh);
        });
        let seed = 827;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
        const perEvent = mobile ? 3 : 5, count = GROUND_EVENTS.length * perEvent;
        for (let v = 0; v < 6; v++) {
            const slots = Math.floor(count / 6) + (v < count % 6 ? 1 : 0);
            const mesh = new THREE.InstancedMesh(earth[v], this.material, slots);
            mesh.name = `GroundDebris${v}`; mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.debris.push(mesh); this.root.add(mesh);
        }
        for (let i = 0; i < count; i++) {
            const event = GROUND_EVENTS[Math.floor(i / perEvent)], side = event.x < 0 ? -1 : 1;
            const size = 0.032 + random() ** 1.5 * 0.040;
            this.fragments.push({ variant: i % 6, instance: Math.floor(i / 6), birth: event.time + random() * 0.035,
                base: new THREE.Vector3(event.x + (random() - 0.5) * 0.18, event.y, event.z + (random() - 0.5) * 0.16),
                velocity: new THREE.Vector3(side * (0.30 + random() * 0.65), event.kind === 'breakthrough' ? 0.9 + random() * 0.65 : 0.26 + random() * 0.42, (random() - 0.5) * 0.8),
                rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)),
                axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(), spin: 3 + random() * 6,
                scale: new THREE.Vector3(size, size * (0.7 + random() * 0.6), size * (0.8 + random() * 0.4)),
            });
        }
        this.reset(); this.setActive(false);
    }

    get fillLightIntensity(): number {
        return this.finished ? 0.18 : groundSmooth(0, 0.4, this.time) * (1.8 - groundSmooth(1.45, 3.1, this.time) * 1.62);
    }
    get cardDepthVisible(): boolean { return this.transformation.cardDepthVisible; }
    get fogDepthRevision(): string { return this.finished ? 'ground-finished' : String(this.time); }
    setActive(active: boolean): void { this.root.visible = active; this.transformation.setActive(active); }
    addToTimeline(timeline: gsap.core.Timeline): void { this.transformation.addToTimeline(timeline); }

    /** All positions are functions of absolute time, including backwards seek and replay. */
    update(time: number, _viewportHeight: number): void {
        this.time = time; this.transformation.update(time);
        this.root.updateWorldMatrix(true, false);
        this.floor.copy(this.localFloor).applyMatrix4(this.root.matrixWorld);
        for (let i = 0; i < this.pillars.length; i++) {
            const p = GROUND_PILLARS[i], extension = groundExtension(time, p), mesh = this.pillars[i];
            mesh.position.set(p.x, GROUND_FLOOR, p.z).addScaledVector(this.axes[i], -(1 - extension) * (p.height + 0.08));
            mesh.visible = !this.finished && time >= p.birth && time < p.hidden;
        }
        for (let i = 0; i < this.rubble.length; i++) {
            const stagger = (i % 3) * 0.07 + Math.floor(i / 3) * 0.035;
            const birth = 0.36 + stagger, retreat = 2.35 + stagger * 0.8, hidden = retreat + 0.62;
            const rise = groundSmooth(birth, birth + 0.40, time) * 1.02
                - groundSmooth(birth + 0.40, birth + 0.48, time) * 0.02;
            const extension = rise * (1 - groundSmooth(retreat, hidden, time));
            // Fixed-size stones emerge through the clip plane, settle, then sink completely.
            this.rubble[i].visible = !this.finished && time >= birth && time < hidden;
            this.rubble[i].position.y = -0.42 * (1 - extension);
        }
        this.live = 0;
        for (const p of this.fragments) {
            const age = time - p.birth;
            earthPosition(this.dummy.position, p.base, p.velocity, Math.max(0, age), GROUND_GRAVITY);
            const alive = !this.finished && age >= 0 && age < 1.1 && this.dummy.position.y > GROUND_FLOOR - 0.06;
            if (alive) this.live++; else this.dummy.position.y = -20;
            earthRotation(this.dummy.quaternion, this.spin, p.rotation, p.axis, age, p.spin);
            this.dummy.scale.copy(p.scale); this.dummy.updateMatrix();
            this.debris[p.variant].setMatrixAt(p.instance, this.dummy.matrix);
        }
        for (const mesh of this.debris) { mesh.visible = this.live > 0; mesh.instanceMatrix.needsUpdate = true; }
    }

    withFogDepth<T>(render: () => T): T {
        const visible = this.transformation.root.visible;
        this.transformation.root.visible = false;
        this.root.traverse(object => { if (object instanceof THREE.Mesh && object.material === this.material) object.material = this.depth; });
        try { return render(); } finally {
            this.root.traverse(object => { if (object instanceof THREE.Mesh && object.material === this.depth) object.material = this.material; });
            this.transformation.root.visible = visible;
        }
    }
    async compileFogDepth(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
        await this.withFogDepth(() => renderer.compileAsync(this.root, camera, scene));
    }
    getDebugInfo() { return { pillars: this.pillars.length, rubble: this.rubble.length, fragments: this.fragments.length,
        live: this.live, events: GROUND_EVENTS.length, gravity: GROUND_GRAVITY, finished: this.finished }; }
    reset(): void { this.finished = false; this.transformation.reset(); this.update(0, 800); }
    finish(): void { this.finished = true; this.transformation.finish(); this.update(3.5, 800); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.root.removeFromParent(); this.transformation.dispose();
        for (const geometry of this.geometries) geometry.dispose();
        for (const mesh of [...this.rubble, ...this.debris]) mesh.dispose();
        this.material.dispose(); this.depth.dispose();
    }
}
