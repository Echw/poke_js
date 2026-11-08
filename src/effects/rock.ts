import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import { createEarthGeometry } from './fightingMaterial';
import { earthPosition, earthRotation } from './earthMotion';
import { createRockGeometry, createRockMaterial } from './rockMaterial';
import { ROCK_POSES, rockPosition, rockRotation } from './rockMotion';
import type { PokemonRevealEffect } from './types';

type Chip = { variant: number; slot: number; birth: number; base: THREE.Vector3; velocity: THREE.Vector3;
    rotation: THREE.Quaternion; axis: THREE.Vector3; size: number; spin: number };

/** Confined cream-gold scattering between stones; opaque Ball geometry still occludes it. */
function createEnergy(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `varying vec2 vUv;uniform float uTime;
            void main(){vec2 p=(vUv-vec2(0.5,0.25))*vec2(1.0,1.25);float r=length(p);
                float core=exp(-r*r*650.0);float halo=exp(-r*r*26.0)*0.48;
                float angle=atan(p.x,max(0.008,p.y));
                float rays=pow(max(0.0,sin(angle*19.0+sin(angle*7.0)*1.4+uTime*0.3)),14.0);
                rays*=exp(-r*3.0)*smoothstep(0.0,0.06,p.y)*(1.0-smoothstep(0.50,0.85,p.y))*0.95;
                float haze=exp(-p.x*p.x/max(0.003,0.006+p.y*0.12))*exp(-max(0.0,p.y)*2.0);
                haze*=smoothstep(-0.04,0.03,p.y)*(1.0-smoothstep(0.55,0.90,p.y))*0.60;
                float energy=smoothstep(0.0,0.65,uTime)*(1.0-smoothstep(1.45,2.40,uTime));
                vec3 color=mix(vec3(1.25,0.65,0.22),vec3(1.65,1.35,0.85),core);
                float bounds=1.0-smoothstep(0.36,0.50,abs(vUv.x-0.5));
                gl_FragColor=vec4(color,(core+halo+rays+haze)*energy*bounds);
                #include <colorspace_fragment>
            }`, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.25), material);
    mesh.name = 'RockEnergy'; mesh.position.set(0, 0.34, 0.68); mesh.renderOrder = 2;
    return mesh;
}

/** Small analytic sand puffs follow Ground's localized, quickly dissipating emissions. */
function createDust(mobile: boolean, luminous = false): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const count = luminous ? mobile ? 16 : 24 : mobile ? 32 : 56, positions = [], births = [], sizes = [];
    for (let i = 0; i < count; i++) {
        const phase = i * 2.39996, settling = i % 3 === 2;
        positions.push(Math.cos(phase) * (settling ? 0.45 : 0.25), -0.13, 0.43 + Math.sin(phase) * 0.2);
        births.push(luminous ? 0.20 + i / count * 1.20 : (settling ? 2.55 : i % 3 ? 0.76 : 0.39) + (i % 7) * 0.027);
        sizes.push(luminous ? 0.006 + (i % 3) * 0.003 : 0.035 + (i % 5) * 0.008);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aBirth', new THREE.Float32BufferAttribute(births, 1));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uHeight: { value: 800 } },
        defines: luminous ? { GRAINS: 1 } : {},
        vertexShader: `attribute float aBirth,aSize; uniform float uTime,uHeight; varying float vAlpha;
            void main(){float age=uTime-aBirth;float life=clamp(age/0.6,0.0,1.0);
                vAlpha=step(0.0,age)*sin(life*3.14159)*0.13;
                vec3 p=position; p.x+=sin(aBirth*31.0)*life*0.11;p.y+=life*0.12;p.z+=cos(aBirth*23.0)*life*0.08;
                #ifdef GRAINS
                life=clamp(age/1.0,0.0,1.0);vAlpha=step(0.0,age)*sin(life*3.14159)*0.75;
                p=position;p.y+=life*(0.20+fract(aBirth*37.0)*0.42);p.x+=sin(aBirth*31.0)*life*0.12;
                #endif
                vec4 view=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*view;
                gl_PointSize=clamp(aSize*(1.0+life)*uHeight/max(0.1,-view.z),1.0,30.0);}`,
        fragmentShader: `varying float vAlpha;void main(){float d=length(gl_PointCoord-0.5)*2.0;
            vec3 color=vec3(0.64,0.48,0.29);
            #ifdef GRAINS
            color=vec3(1.4,1.0,0.50);
            #endif
            gl_FragColor=vec4(color,exp(-d*d*4.0)*(1.0-smoothstep(0.7,1.0,d))*vAlpha);
            #include <colorspace_fragment>
        }`, transparent: true, depthWrite: false, toneMapped: false,
        blending: luminous ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geometry, material); points.name = luminous ? 'RockGrains' : 'RockSand'; points.frustumCulled = false;
    return points;
}

/** Four rigid boulders use the existing scene clock and shared card handoff. */
export class RockEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xffdc9e);
    readonly fillLightPosition = new THREE.Vector3(0, 0.10, 0.57);
    readonly transformation: CardTransformation;
    private readonly floor = new THREE.Plane();
    private readonly localFloor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.20);
    private readonly soil = createRockMaterial(this.floor);
    readonly ready = this.soil.ready;
    private readonly boulders: THREE.Mesh[] = [];
    private readonly axes: THREE.Vector3[] = [];
    private readonly debris: THREE.InstancedMesh[] = [];
    private readonly rubble: THREE.InstancedMesh[] = [];
    private readonly chips: Chip[] = [];
    private readonly dust: ReturnType<typeof createDust>;
    private readonly grains: ReturnType<typeof createDust>;
    private readonly energy = createEnergy();
    private readonly dummy = new THREE.Object3D();
    private readonly spin = new THREE.Quaternion();
    private time = 0;
    private finished = false;
    private disposed = false;
    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'RockEffect';
        this.transformation = new CardTransformation(card, 'rock', mobile);
        this.root.add(this.transformation.root);
        ROCK_POSES.forEach((p, i) => {
            const mesh = new THREE.Mesh(createRockGeometry(i), this.soil.material);
            mesh.name = `RockBoulder${i}`; mesh.scale.set(p.size[0], p.size[1], p.size[2]);
            this.boulders.push(mesh); this.axes.push(new THREE.Vector3(...p.axis).normalize()); this.root.add(mesh);
        });
        const count = mobile ? 30 : 48;
        let seed = 7531;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
        for (let variant = 0; variant < 3; variant++) {
            const mesh = new THREE.InstancedMesh(createEarthGeometry(variant + 3), this.soil.material, count / 3);
            mesh.name = `RockChips${variant}`; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.debris.push(mesh); this.root.add(mesh);
            const rubble = new THREE.InstancedMesh(mesh.geometry, this.soil.material, 4);
            rubble.name = `RockBed${variant}`;
            for (let slot = 0; slot < 4; slot++) {
                const angle = (slot * 3 + variant) * 2.39996;
                const radius = 0.16 + (slot % 2) * 0.23;
                this.dummy.position.set(Math.cos(angle) * radius, -0.18, 0.46 + Math.sin(angle) * radius * 0.65);
                this.dummy.rotation.set(slot * 0.7, angle, variant * 0.4);
                this.dummy.scale.set(0.14 + slot * 0.018, 0.075, 0.14); this.dummy.updateMatrix();
                rubble.setMatrixAt(slot, this.dummy.matrix);
            }
            this.rubble.push(rubble); this.root.add(rubble);
        }
        for (let i = 0; i < count; i++) {
            const event = Math.floor(i / (count / 3)), side = i % 2 ? 1 : -1;
            const settling = event === 2;
            this.chips.push({ variant: i % 3, slot: Math.floor(i / 3), birth: [0.44, 0.84, 2.56][event] + random() * 0.12,
                base: new THREE.Vector3(side * (settling ? 0.43 : 0.25), settling ? -0.07 : 0.02, 0.44 + random() * 0.20),
                velocity: new THREE.Vector3(side * (settling ? 0.35 + random() * 0.40 : 1.35 + random() * 0.85),
                    settling ? 0.65 + random() * 0.45 : 1.05 + random() * 0.75, (random() - 0.5) * 0.36),
                rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * 6, random() * 6, random() * 6)),
                axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
                size: 0.024 + random() * 0.026, spin: 2 + random() * 4 });
        }
        this.dust = createDust(mobile); this.root.add(this.dust);
        this.grains = createDust(mobile, true); this.root.add(this.grains);
        this.root.add(this.energy);
        this.reset(); this.setActive(false);
    }
    get fillLightIntensity(): number {
        return this.finished ? 0.08 : THREE.MathUtils.smoothstep(this.time, 0, 0.6)
            * (0.70 + Math.sin(this.time * 5) * 0.04) * (1 - THREE.MathUtils.smoothstep(this.time, 1.6, 3.1));
    }
    setActive(active: boolean): void { this.root.visible = active; this.transformation.setActive(active); }
    addToTimeline(timeline: gsap.core.Timeline): void { this.transformation.addToTimeline(timeline); }
    update(time: number, viewportHeight: number): void {
        this.time = time; this.transformation.update(time);
        this.root.updateWorldMatrix(true, false);
        this.floor.copy(this.localFloor).applyMatrix4(this.root.matrixWorld);
        for (let i = 0; i < this.boulders.length; i++) {
            rockPosition(this.boulders[i].position, i, time);
            rockRotation(this.boulders[i].quaternion, this.axes[i], i, time);
            this.boulders[i].visible = !this.finished && time < 3.15;
        }
        for (const mesh of this.rubble) {
            mesh.position.y = -0.24 * THREE.MathUtils.smootherstep(time, 2.45, 3.15);
            mesh.visible = !this.finished && time < 3.15;
        }
        for (const p of this.chips) {
            const age = time - p.birth;
            earthPosition(this.dummy.position, p.base, p.velocity, Math.max(0, age), 4.3);
            if (this.finished || age < 0 || age > 0.75 || this.dummy.position.y < -0.17) this.dummy.position.y = -20;
            earthRotation(this.dummy.quaternion, this.spin, p.rotation, p.axis, age, p.spin);
            this.dummy.scale.set(p.size, p.size * 0.8, p.size * 0.9); this.dummy.updateMatrix();
            this.debris[p.variant].setMatrixAt(p.slot, this.dummy.matrix);
        }
        for (const mesh of this.debris) { mesh.instanceMatrix.needsUpdate = true; mesh.visible = !this.finished; }
        this.dust.visible = !this.finished;
        this.dust.material.uniforms.uTime.value = time; this.dust.material.uniforms.uHeight.value = viewportHeight;
        this.grains.visible = !this.finished;
        this.grains.material.uniforms.uTime.value = time; this.grains.material.uniforms.uHeight.value = viewportHeight;
        this.energy.visible = !this.finished; this.energy.material.uniforms.uTime.value = time;
    }
    getDebugInfo() { return { boulders: this.boulders.length, chips: this.chips.length, finished: this.finished }; }
    reset(): void { this.finished = false; this.transformation.reset(); this.update(0, 800); }
    finish(): void { this.finished = true; this.transformation.finish(); this.update(3.5, 800); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true; this.root.removeFromParent(); this.transformation.dispose();
        for (const mesh of this.boulders) mesh.geometry.dispose();
        for (const mesh of this.debris) { mesh.geometry.dispose(); mesh.dispose(); }
        for (const mesh of this.rubble) mesh.dispose();
        this.soil.material.dispose(); this.dust.geometry.dispose(); this.dust.material.dispose();
        this.grains.geometry.dispose(); this.grains.material.dispose();
        this.energy.geometry.dispose(); this.energy.material.dispose();
    }
}
