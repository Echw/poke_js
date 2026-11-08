import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import { createEarthGeometry, createEarthMaterial } from './fightingMaterial';
import { fightingImpulse } from './smokeProfile';
import type { PokemonRevealEffect } from './types';

const SOURCE = new THREE.Vector3(0, -0.09, 0.28);
const GRAVITY = 4.3;
const EMISSION_END = 1.2;
type DebrisPose = { variant: number; instance: number; birth: number; base: THREE.Vector3;
    velocity: THREE.Vector3; axis: THREE.Vector3; rotation: THREE.Quaternion; spin: number; scale: THREE.Vector3 };

function seededRandom(seed: number): () => number {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
}

/** Brief fractured jets travel outwards; no continuous curving bands remain at the source. */
function createImpact(mobile: boolean): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const positions: number[] = [], uvs: number[] = [], births: number[] = [], indices: number[] = [];
    const random = seededRandom(691);
    const count = mobile ? 14 : 22;
    for (let i = 0; i < count; i++) {
        const side = i % 2 ? 1 : -1;
        const direction = new THREE.Vector3(side * (0.8 + random() * 0.5), 0.45 + random() * 0.85, (random() - 0.55) * 0.8).normalize();
        const across = new THREE.Vector3(-direction.y, direction.x, 0).normalize();
        const length = 0.85 + random() * 0.8, width = 0.045 + random() * 0.055;
        const birth = (i < count / 2 ? 0.55 : 0.90) + random() * 0.13;
        const offset = positions.length / 3;
        for (let segment = 0; segment <= 12; segment++) {
            const t = segment / 12;
            for (const sign of [-1, 1]) {
                const spread = sign * width * (1 - t) * (0.5 + random() * 0.5);
                const p = direction.clone().multiplyScalar(t * length).addScaledVector(across, spread);
                positions.push(p.x, p.y, p.z); uvs.push((sign + 1) / 2, t); births.push(birth);
            }
            if (segment < 12) {
                const a = offset + segment * 2;
                indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('aBirth', new THREE.Float32BufferAttribute(births, 1));
    geometry.setIndex(indices);
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSource: { value: SOURCE } },
        vertexShader: `uniform float uTime;uniform vec3 uSource;attribute float aBirth;
            varying vec2 vUv;varying float vAge;
            void main(){vUv=uv;vAge=uTime-aBirth;
                float extension=1.0-pow(1.0-clamp(vAge/0.11,0.0,1.0),3.0);
                gl_Position=projectionMatrix*modelViewMatrix*vec4(uSource+position*extension,1.0);}`,
        fragmentShader: `varying vec2 vUv;varying float vAge;
            void main(){float life=smoothstep(0.0,0.018,vAge)*(1.0-smoothstep(0.12,0.24,vAge));
                float head=clamp(vAge/0.16,0.0,1.0);
                float packet=smoothstep(head-0.34,head-0.17,vUv.y)*(1.0-smoothstep(head-0.06,head,vUv.y));
                float edge=pow(max(0.0,1.0-abs(vUv.x*2.0-1.0)),2.4);
                float chips=0.3+0.7*smoothstep(-0.2,0.6,sin(vUv.y*81.0));
                vec3 color=mix(vec3(1.6,0.035,0.002),vec3(2.0,0.85,0.2),edge);
                gl_FragColor=vec4(color,edge*life*packet*chips*1.5);
                #include <colorspace_fragment>
            }`,
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
        forceSinglePass: true, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'FightingImpact'; mesh.frustumCulled = false; mesh.renderOrder = 3;
    return mesh;
}

function createSparks(mobile: boolean): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const count = mobile ? 150 : 280, random = seededRandom(719);
    const velocities = [], births = [], sizes = [], lifetimes = [];
    for (let i = 0; i < count; i++) {
        velocities.push((i % 2 ? 1 : -1) * (0.45 + random() * 2.5), 0.6 + random() * 3.1, (random() - 0.6) * 1.7);
        births.push(0.55 + random() * 0.65); sizes.push(0.009 + random() ** 2 * 0.025);
        lifetimes.push(0.45 + random() * 0.65);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aVelocity', new THREE.Float32BufferAttribute(velocities, 3));
    geometry.setAttribute('aBirth', new THREE.Float32BufferAttribute(births, 1));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('aLife', new THREE.Float32BufferAttribute(lifetimes, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uHeight: { value: 800 }, uSource: { value: SOURCE } },
        vertexShader: `uniform float uTime,uHeight;uniform vec3 uSource;
            attribute vec3 aVelocity;attribute float aBirth,aSize,aLife;varying float vFade;
            void main(){float age=uTime-aBirth;vFade=step(0.0,age)*(1.0-smoothstep(aLife*0.35,aLife,age));
                vec3 p=uSource+aVelocity*age; p.y-=2.15*age*age;
                vec4 view=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*view;
                gl_PointSize=clamp(aSize*uHeight/max(0.1,-view.z),1.0,10.0);}`,
        fragmentShader: `varying float vFade;void main(){float d=length(gl_PointCoord-0.5)*2.0;
            float a=(1.0-smoothstep(0.15,1.0,d))*vFade;
            gl_FragColor=vec4(mix(vec3(1.0,0.08,0.008),vec3(1.8,0.85,0.24),1.0-d),a);
            #include <colorspace_fragment>
        }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'FightingSparks'; points.frustumCulled = false; points.renderOrder = 3;
    return points;
}

/** Owns Fighting visuals; scene owns playback, depth capture, smoke and rendering. */
export class FightingEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xff3b0b);
    readonly fillLightPosition = SOURCE.clone();
    readonly transformation: CardTransformation;
    private readonly debris: THREE.InstancedMesh[] = [];
    private readonly poses: DebrisPose[] = [];
    private readonly energy = { value: 0 };
    private readonly material = createEarthMaterial(this.energy);
    private readonly depthMaterial = new THREE.MeshDepthMaterial({ depthWrite: true });
    private readonly impact: ReturnType<typeof createImpact>;
    private readonly sparks: ReturnType<typeof createSparks>;
    private readonly dummy = new THREE.Object3D();
    private readonly spin = new THREE.Quaternion();
    private time = 0;
    private finished = false;
    private disposed = false;
    private liveDebris = 0;
    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'FightingEffect';
        this.transformation = new CardTransformation(card, 'fighting', mobile);
        this.root.add(this.transformation.root);
        this.impact = createImpact(mobile); this.sparks = createSparks(mobile);
        this.root.add(this.impact, this.sparks);
        const count = mobile ? 28 : 48, random = seededRandom(1703), color = new THREE.Color();
        const counts = Array.from({ length: 6 }, (_, v) => Math.floor(count / 6) + (v < count % 6 ? 1 : 0));
        for (let variant = 0; variant < 6; variant++) {
            const geometry = createEarthGeometry(variant);
            geometry.setAttribute('aEarthSeed', new THREE.InstancedBufferAttribute(
                Float32Array.from({ length: counts[variant] }, () => random() * 10), 1));
            const mesh = new THREE.InstancedMesh(geometry, this.material, counts[variant]);
            mesh.name = `FightingEarth${variant}`; mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.debris.push(mesh); this.root.add(mesh);
            for (let instance = 0; instance < counts[variant]; instance++) {
                const i = this.poses.length, side = i % 2 ? 1 : -1;
                const size = instance === 0 && variant < 4 ? 0.095 + random() * 0.025 : 0.025 + random() * 0.035;
                const birth = 0.55 + random() * (EMISSION_END - 0.55);
                this.poses.push({ variant, instance, birth,
                    base: new THREE.Vector3((random() - 0.5) * 0.36, -0.12, 0.12 + random() * 0.18),
                    velocity: new THREE.Vector3(side * (0.65 + random() * 1.5), 1.7 + random() * 1.35, (random() - 0.65) * 1.25),
                    axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
                    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)),
                    spin: 2 + random() * 5, scale: new THREE.Vector3(size * (0.8 + random() * 0.4), size, size * (0.75 + random() * 0.4)),
                });
                color.set(variant < 3 ? 0x755244 : 0x54504a).multiplyScalar(0.7 + random() * 0.55);
                mesh.setColorAt(instance, color);
            }
        }
        this.depthMaterial.colorWrite = false;
        this.setActive(false);
    }
    get fillLightIntensity(): number {
        return this.finished ? 0.12 : (0.35 + fightingImpulse(this.time) * 5.8)
            * THREE.MathUtils.smoothstep(this.time, 0, 0.4) * (1 - THREE.MathUtils.smoothstep(this.time, 1.45, 3.5));
    }
    get cardDepthVisible(): boolean { return this.time >= 2.15; }
    get fogDepthRevision(): string { return `${this.time}:${this.finished}`; }
    /** Excludes energy from opaque depth; native instanced meshes retain identical poses. */
    withFogDepth<T>(render: () => T): T {
        const impact = this.impact.visible, sparks = this.sparks.visible, source = this.transformation.root.visible;
        this.impact.visible = this.sparks.visible = this.transformation.root.visible = false;
        for (const mesh of this.debris) mesh.material = this.depthMaterial;
        try { return render(); }
        finally {
            this.impact.visible = impact; this.sparks.visible = sparks; this.transformation.root.visible = source;
            for (const mesh of this.debris) mesh.material = this.material;
        }
    }
    async compileFogDepth(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
        await this.withFogDepth(() => renderer.compileAsync(this.root, camera, scene));
    }
    setActive(active: boolean): void { this.root.visible = active; this.transformation.setActive(active); }
    addToTimeline(timeline: gsap.core.Timeline): void { this.transformation.addToTimeline(timeline); }
    update(time: number, viewportHeight: number): void {
        this.time = time;
        this.transformation.update(time);
        this.energy.value = (0.15 + fightingImpulse(time) * 1.5) * (1 - THREE.MathUtils.smoothstep(time, 1.45, 2.8));
        this.impact.material.uniforms.uTime.value = this.sparks.material.uniforms.uTime.value = time;
        this.sparks.material.uniforms.uHeight.value = viewportHeight;
        this.impact.visible = !this.finished && time > 0.55 && time < 1.45;
        this.sparks.visible = !this.finished && time > 0.55 && time < 2.3;
        this.liveDebris = 0;
        for (let i = 0; i < this.poses.length; i++) {
            const pose = this.poses[i], age = time - pose.birth;
            this.dummy.position.copy(pose.base);
            const trembling = i < 4 && time > 0.1 && age < 0;
            if (age >= 0) {
                this.dummy.position.addScaledVector(pose.velocity, age);
                this.dummy.position.y -= 0.5 * GRAVITY * age * age;
            } else if (trembling) this.dummy.position.y += Math.sin(time * 58 + i) * 0.006;
            const alive = !this.finished && (trembling || age >= 0 && this.dummy.position.y > -1.45 && age < 2.1);
            if (alive) this.liveDebris++;
            else this.dummy.position.set(0, -20, 0);
            this.spin.setFromAxisAngle(pose.axis, Math.max(0, age) * pose.spin);
            this.dummy.quaternion.copy(pose.rotation).premultiply(this.spin);
            this.dummy.scale.copy(pose.scale);
            this.dummy.updateMatrix();
            this.debris[pose.variant].setMatrixAt(pose.instance, this.dummy.matrix);
        }
        for (const mesh of this.debris) { mesh.visible = this.liveDebris > 0; mesh.instanceMatrix.needsUpdate = true; }
    }
    getDebugInfo() { return { count: this.poses.length, variants: this.debris.length, live: this.liveDebris,
        emissionEnd: EMISSION_END, energy: this.energy.value, gravity: GRAVITY }; }
    reset(): void { this.finished = false; this.transformation.reset(); this.update(0, 800); }
    finish(): void { this.finished = true; this.transformation.finish(); this.update(3.5, 800); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.root.removeFromParent(); this.transformation.dispose();
        for (const mesh of this.debris) { mesh.geometry.dispose(); mesh.dispose(); }
        this.material.dispose(); this.depthMaterial.dispose();
        this.impact.geometry.dispose(); this.impact.material.dispose();
        this.sparks.geometry.dispose(); this.sparks.material.dispose();
    }
}
