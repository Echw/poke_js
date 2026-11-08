import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import { createPoolGeometry } from './liquidSurface';
import { poisonFragment, poisonVertex } from './poisonMaterial';
import { POISON_EVENTS, POISON_EVENT_CAPACITY, POISON_LIMITS, bubblePose, dropPose, smooth } from './poisonEvents';
import type { PokemonRevealEffect } from './types';

/** Bounded procedural cauldron. The host owns time, smoke, camera and the only render loop. */
export class PoisonEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xa31bdc);
    readonly fillLightPosition = new THREE.Vector3(0, -0.02, 0.34);
    readonly transformation: CardTransformation;
    private readonly events;
    private readonly pool: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly bubbles: THREE.InstancedMesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
    private readonly drops: THREE.InstancedMesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
    private readonly splashes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
    private readonly bubbleData: THREE.InstancedBufferAttribute;
    private readonly worldToCard = new THREE.Matrix4();
    private readonly dummy = new THREE.Object3D();
    private readonly up = new THREE.Vector3(0, 1, 0);
    private readonly velocity = new THREE.Vector3();
    private readonly bubblePose = bubblePose(POISON_EVENTS[0]!, 0, POISON_EVENTS);
    private readonly dropPose = dropPose(POISON_EVENTS[0]!, 0, 0, POISON_EVENTS);
    private readonly uniforms;
    private readonly dropsPerEvent: number;
    private time = 0;
    private finished = false;
    private disposed = false;

    constructor(card: THREE.Mesh, environment: THREE.Texture, mobile = false) {
        this.root.name = 'PoisonEffect';
        this.events = POISON_EVENTS.filter(e => !mobile || e.mobile);
        const limits = POISON_LIMITS[mobile ? 'mobile' : 'desktop'];
        this.dropsPerEvent = limits.dropsPerEvent;
        this.transformation = new CardTransformation(card, 'poison', mobile);
        this.root.add(this.transformation.root);
        const positions = Array.from({ length: POISON_EVENT_CAPACITY }, (_, i) => {
            const e = this.events[i]; return e ? new THREE.Vector4(e.x, e.z, e.radius, +e.gas) : new THREE.Vector4();
        });
        const timing = Array.from({ length: POISON_EVENT_CAPACITY }, (_, i) => {
            const e = this.events[i]; return e ? new THREE.Vector4(e.start, e.grow, e.pop, e.seed) : new THREE.Vector4();
        });
        this.uniforms = {
            uTime: { value: 0 }, uEnvironment: { value: environment }, uCardImage: { value: 0 },
            uWorldToCard: { value: this.worldToCard }, uEvents: { value: positions },
            uTiming: { value: timing }, uEventCount: { value: this.events.length },
        };
        const material = (kind: string) => new THREE.ShaderMaterial({
            uniforms: this.uniforms, defines: { [kind]: 1 }, vertexShader: poisonVertex,
            fragmentShader: poisonFragment, transparent: true, depthTest: true, depthWrite: false,
            side: kind === 'SPLASH' || kind === 'POOL' ? THREE.DoubleSide : THREE.FrontSide,
            forceSinglePass: true,
        });
        this.pool = new THREE.Mesh(createPoolGeometry(mobile), material('POOL'));
        // The shared radial grid only needs its analytic normal, supplied in the shader.
        this.pool.geometry.computeVertexNormals();
        this.pool.name = 'PoisonPool'; this.pool.renderOrder = 2;
        this.root.add(this.pool);

        const bubbleGeometry = new THREE.SphereGeometry(1, mobile ? 36 : 56, mobile ? 24 : 36);
        this.bubbleData = new THREE.InstancedBufferAttribute(new Float32Array(limits.bubbles * 4), 4);
        bubbleGeometry.setAttribute('aEvent', this.bubbleData);
        this.bubbles = new THREE.InstancedMesh(bubbleGeometry, material('BUBBLE'), limits.bubbles);
        this.bubbles.name = 'PoisonBubbles'; this.bubbles.renderOrder = 3.1;
        this.root.add(this.bubbles);

        this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, mobile ? 8 : 12, mobile ? 6 : 8), material('DROP'), limits.drops);
        this.drops.name = 'PoisonDrops'; this.drops.renderOrder = 3.2;
        this.root.add(this.drops);

        const crown = new THREE.PlaneGeometry(1, 1, mobile ? 48 : 72, 5);
        const splashGeometry = new THREE.InstancedBufferGeometry();
        splashGeometry.setIndex(crown.index);
        for (const [name, attribute] of Object.entries(crown.attributes)) splashGeometry.setAttribute(name, attribute);
        crown.dispose();
        splashGeometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(Float32Array.from(this.events, (_, i) => i), 1));
        splashGeometry.instanceCount = this.events.length;
        this.splashes = new THREE.Mesh(splashGeometry, material('SPLASH'));
        this.splashes.name = 'PoisonSplashes'; this.splashes.renderOrder = 3.15;
        this.root.add(this.splashes);
        for (const mesh of [this.pool, this.bubbles, this.drops, this.splashes]) {
            mesh.frustumCulled = false;
            mesh.onBeforeRender = () => {
                card.updateWorldMatrix(true, false);
                this.worldToCard.copy(card.matrixWorld).invert();
            };
        }
        this.reset(); this.setActive(false);
    }

    get fillLightIntensity(): number {
        return this.finished ? 0.10 : (0.35 + 1.8 * smooth(0.1, 0.95, this.time)) * (1 - smooth(1.45, 3.5, this.time));
    }
    get cardDepthVisible(): boolean { return this.time >= 2.15; }
    get fogDepthRevision(): string { return `${this.time}:${this.finished}`; }
    /** Thin membranes and energy cannot occlude the volume as opaque shells. */
    withFogDepth<T>(render: () => T): T {
        const visible = this.root.visible; this.root.visible = false;
        try { return render(); } finally { this.root.visible = visible; }
    }
    async compileFogDepth(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
        await this.withFogDepth(() => renderer.compileAsync(this.root, camera, scene));
    }
    setActive(active: boolean): void {
        if (this.disposed) return;
        this.root.visible = active; this.transformation.setActive(active);
    }
    addToTimeline(timeline: gsap.core.Timeline): void { this.transformation.addToTimeline(timeline); }
    update(time: number, _viewportHeight: number): void {
        if (this.disposed) return;
        this.time = time; this.transformation.update(time);
        this.uniforms.uTime.value = time;
        this.uniforms.uCardImage.value = this.transformation.state.cardImage;
        let bubble = 0, drop = 0;
        if (!this.finished) for (const e of this.events) {
            const pose = bubblePose(e, time, this.events, this.bubblePose);
            if (pose.visible && bubble < this.bubbleData.count) {
                this.dummy.position.set(pose.x, pose.y, pose.z);
                this.dummy.quaternion.identity();
                this.dummy.scale.set(pose.radius, pose.radius * pose.stretch, pose.radius);
                this.dummy.updateMatrix(); this.bubbles.setMatrixAt(bubble, this.dummy.matrix);
                this.bubbleData.setXYZW(bubble, pose.rupture, e.seed, +e.gas, 0); bubble++;
            }
            for (let i = 0; i < this.dropsPerEvent; i++) {
                const p = dropPose(e, i, time, this.events, this.dropPose);
                if (!p.visible || drop >= this.drops.instanceMatrix.count) continue;
                this.dummy.position.set(p.x, p.y, p.z);
                this.velocity.set(p.vx, p.vy, p.vz).normalize();
                this.dummy.quaternion.setFromUnitVectors(this.up, this.velocity);
                this.dummy.scale.set(p.size, p.size * 1.45, p.size);
                this.dummy.updateMatrix(); this.drops.setMatrixAt(drop++, this.dummy.matrix);
            }
        }
        this.bubbles.count = bubble; this.drops.count = drop;
        this.bubbleData.needsUpdate = true;
        this.bubbles.instanceMatrix.needsUpdate = this.drops.instanceMatrix.needsUpdate = true;
        this.bubbles.visible = bubble > 0; this.drops.visible = drop > 0;
        this.pool.visible = this.splashes.visible = !this.finished && time > 0 && time < 3.5;
    }
    getDebugInfo() {
        return { liveBubbles: this.bubbles.count, liveDrops: this.drops.count,
            bubbleCapacity: this.bubbleData.count, dropCapacity: this.drops.instanceMatrix.count,
            events: this.events.map(e => ({ ...e, ...bubblePose(e, this.time, this.events) })),
            drops: this.events.flatMap(e => Array.from({ length: this.dropsPerEvent }, (_, i) => ({ event: e.seed, ...dropPose(e, i, this.time, this.events) }))).filter(p => p.visible),
        };
    }
    reset(): void {
        if (this.disposed) return;
        this.finished = false; this.transformation.reset(); this.update(0, 800);
    }
    finish(): void {
        if (this.disposed) return;
        this.finished = true; this.transformation.finish(); this.update(3.5, 800);
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.root.removeFromParent(); this.transformation.dispose();
        for (const mesh of [this.pool, this.bubbles, this.drops, this.splashes]) {
            mesh.geometry.dispose(); mesh.material.dispose();
        }
        this.bubbles.dispose(); this.drops.dispose();
    }
}
