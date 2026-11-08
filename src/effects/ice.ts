import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { CardTransformation, CARD_REVEAL_TIMING as T } from './cardTransformation';
import { createCrystalMaterial, createIceEnvironment, iceFractures } from './iceMaterial';
import type { PokemonRevealEffect } from './types';

const ICE = {
    start: 0.4, grown: 1.1, retract: T.image, hidden: T.fade, floor: -0.11,
    desktop: { large: 9, front: 5, shards: 24 },
    mobile: { large: 6, front: 3, shards: 12 },
} as const;

interface CrystalPose {
    variant: number;
    instance: number;
    base: THREE.Vector3;
    rotation: THREE.Quaternion;
    scale: THREE.Vector3;
    axis: THREE.Vector3;
    birth: number;
    retract: number;
    duration: number;
}

/** Convex cut stones have real beveled facets; their half-spaces bound interior rays. */
function crystalGeometry(variant: number): { geometry: THREE.BufferGeometry; planes: THREE.Vector4[] } {
    const sides = variant === 1 ? 6 : 5, points: THREE.Vector3[] = [];
    for (const [ring, y] of [0, 0.43, variant === 2 ? 0.66 : 0.79].entries()) for (let i = 0; i < sides; i++) {
        const angle = i / sides * Math.PI * 2 + variant * 0.43 + ring * 0.10;
        const radius = [0.33, 0.51, 0.29][ring] * (1 + Math.sin(i * 4.7 + variant * 2.1) * 0.19);
        points.push(new THREE.Vector3(Math.cos(angle) * radius + y * (variant - 1) * 0.11,
            y + (ring ? Math.sin(i * 3.9 + variant) * 0.075 : 0), Math.sin(angle) * radius));
    }
    const tip = new THREE.Vector3((variant - 1) * 0.16, 1, variant === 1 ? -0.12 : 0.07);
    points.push(tip);
    const geometry = new ConvexGeometry(points), planes: THREE.Vector4[] = [];
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const edges = new Map<string, THREE.Vector3[]>();
    const vertexKey = (i: number) => `${positions.getX(i).toFixed(5)},${positions.getY(i).toFixed(5)},${positions.getZ(i).toFixed(5)}`;
    const edgeKey = (a: number, b: number) => [vertexKey(a), vertexKey(b)].sort().join('|');
    for (let i = 0; i < positions.count; i += 3) {
        const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
        const point = new THREE.Vector3().fromBufferAttribute(positions, i);
        const plane = new THREE.Vector4(normal.x, normal.y, normal.z, -normal.dot(point));
        if (!planes.some(existing => existing.clone().sub(plane).length() < 0.0001)) planes.push(plane);
        for (let edge = 0; edge < 3; edge++) {
            const key = edgeKey(i + edge, i + (edge + 1) % 3);
            const adjacent = edges.get(key) ?? [];
            adjacent.push(normal);
            edges.set(key, adjacent);
        }
    }
    const bary: number[] = [], ridges: number[] = [];
    for (let i = 0; i < positions.count; i += 3) {
        const weights = [0, 1, 2].map(opposite => {
            const adjacent = edges.get(edgeKey(i + (opposite + 1) % 3, i + (opposite + 2) % 3))!;
            return adjacent.length === 2 ? THREE.MathUtils.clamp((1 - adjacent[0].dot(adjacent[1])) * 4, 0, 1) : 0;
        });
        bary.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
        for (let vertex = 0; vertex < 3; vertex++) ridges.push(...weights);
    }
    geometry.setAttribute('aIceBary', new THREE.Float32BufferAttribute(bary, 3));
    geometry.setAttribute('aIceRidges', new THREE.Float32BufferAttribute(ridges, 3));
    if (planes.length > 48) throw new Error('Ice hull exceeds the bounded refraction plane budget');
    geometry.userData.iceTip = tip.toArray();
    return { geometry, planes };
}

/** Native Three.js effect: Sataku stage/material helpers require a host absent in this app. */
export class IceEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0x55c5ff);
    readonly fillLightPosition = new THREE.Vector3(0, 0.025, 0.25);
    readonly transformation: CardTransformation;
    private readonly crown = new THREE.Group();
    private readonly crowns: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>[] = [];
    private readonly shards: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
    private readonly poses: CrystalPose[] = [];
    private readonly floor = new THREE.Plane();
    private readonly localFloor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ICE.floor);
    private readonly depthMaterial: THREE.MeshDepthMaterial;
    private readonly frost: THREE.Mesh<THREE.CircleGeometry, THREE.ShaderMaterial>;
    private readonly dummy = new THREE.Object3D();
    private readonly largeCount: number;
    private readonly reflection: THREE.WebGLRenderTarget;
    private readonly lighting = { position: { value: new THREE.Vector3() }, energy: { value: 0 } };
    private finished = false;
    private disposed = false;
    private time = 0;

    constructor(card: THREE.Mesh, environment: THREE.Texture, renderer: THREE.WebGLRenderer, mobile = false) {
        const profile = mobile ? ICE.mobile : ICE.desktop;
        this.largeCount = profile.large;
        this.root.name = 'IceEffect';
        this.reflection = createIceEnvironment(renderer);
        this.transformation = new CardTransformation(card, 'ice', mobile, environment);
        this.root.add(this.transformation.root);
        this.depthMaterial = new THREE.MeshDepthMaterial({ clippingPlanes: [this.floor], colorWrite: false });
        this.depthMaterial.toneMapped = false;
        this.frost = new THREE.Mesh(new THREE.CircleGeometry(0.88, 48), new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 } },
            transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
            vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
            fragmentShader: `uniform float uTime;varying vec2 vUv;
            ${iceFractures}
            void main(){vec2 p=(vUv-0.5)*2.0;float r=length(p);
                float crack=iceCrack(vec3(p.x,p.y,0.0));
                float reach=smoothstep(0.0,0.4,uTime)*0.98;
                float alpha=(1.0-smoothstep(reach-0.10,reach+0.02,r))*(1.0-smoothstep(2.15,2.85,uTime));
                float core=exp(-dot(p-vec2(0,-0.28),p-vec2(0,-0.28))*24.0);
                gl_FragColor=vec4(mix(vec3(0.008,0.04,0.12),vec3(0.25,0.9,1.6),crack)
                    +vec3(0.5,1.4,2.4)*core,alpha*(0.22+crack*0.42+core*0.25));
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
        }));
        this.frost.rotation.x = -Math.PI / 2;
        this.frost.position.y = -0.09;
        this.frost.renderOrder = 1;
        this.root.add(this.frost);

        this.crown.name = 'IceCrown';
        const variants = Array.from({ length: 3 }, (_, variant) => {
            const shape = crystalGeometry(variant), count = profile.large * 2 / 3;
            shape.geometry.setAttribute('aIceSeed', new THREE.InstancedBufferAttribute(
                Float32Array.from({ length: count }, (_, instance) => 0.71 + (instance * 3 + variant) * 1.37), 1));
            const mesh = new THREE.InstancedMesh(shape.geometry,
                createCrystalMaterial(this.floor, this.reflection.texture, shape.planes, this.lighting), count);
            mesh.name = `IceCrownVariant${variant}`;
            mesh.frustumCulled = false;
            this.crowns.push(mesh);
            this.crown.add(mesh);
            return shape;
        });
        const largeLayout = [
            [-0.63, -0.02, 0.69], [-0.46, -0.14, 0.93], [-0.23, -0.27, 1.25],
            [0.02, -0.34, 0.66], [0.25, -0.24, 1.01], [0.47, -0.13, 0.84],
            [0.64, 0.02, 0.66], [-0.12, 0.10, 0.77], [0.36, 0.12, 0.67],
        ];
        const mobileLayout = [0, 2, 3, 4, 6, 7];
        for (let slot = 0; slot < profile.large * 2; slot++) {
            const small = slot >= profile.large, i = slot % profile.large;
            const front = small && i < profile.front;
            let x: number, z: number, height: number;
            if (front) {
                x = (i / (profile.front - 1) - 0.5) * 0.56;
                z = 0.75 - Math.abs(x) * 0.04;
                height = 0.25 + i % 3 * 0.035;
            } else if (small) {
                const j = i - profile.front, count = profile.large - profile.front;
                const angle = Math.PI * (0.06 + j / (count - 1) * 0.88);
                x = Math.cos(angle) * 0.73;
                z = -Math.sin(angle) * 0.13 + 0.26;
                height = 0.34 + i % 3 * 0.035;
            } else {
                [x, z, height] = largeLayout[mobile ? mobileLayout[i] : i];
            }
            const axis = front ? new THREE.Vector3(x * 2.4, 0.65, 0.65).normalize()
                : new THREE.Vector3(x * 0.95, 1, -0.08).normalize();
            const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.73));
            this.poses.push({
                variant: slot % 3, instance: Math.floor(slot / 3),
                base: new THREE.Vector3(x, ICE.floor, z), rotation,
                scale: new THREE.Vector3(small ? (front ? 0.085 : 0.17) : 0.32 + i % 3 * 0.025,
                    height, small ? (front ? 0.095 : 0.20) : 0.35 + i % 2 * 0.035),
                axis,
                birth: ICE.start + (i * 5 % profile.large) / profile.large * 0.18 + (small ? 0.04 : 0),
                retract: ICE.retract + (small ? 0.14 : 0) + (i % 3) * 0.035,
                duration: small ? 0.45 : 0.49,
            });
        }
        this.root.add(this.crown);
        const shardMaterial = createCrystalMaterial(this.floor, this.reflection.texture, variants[0].planes, this.lighting);
        shardMaterial.thickness = 0.035;
        shardMaterial.attenuationDistance = 1.5;
        const shardGeometry = variants[0].geometry.clone();
        shardGeometry.setAttribute('aIceSeed', new THREE.InstancedBufferAttribute(
            Float32Array.from({ length: profile.shards }, (_, i) => i * 1.63 + 2), 1));
        this.shards = new THREE.InstancedMesh(shardGeometry, shardMaterial, profile.shards);
        this.shards.name = 'IceBurst';
        this.shards.frustumCulled = false;
        this.root.add(this.shards);
        this.setActive(false);
    }

    get cardDepthVisible(): boolean { return this.transformation.cardDepthVisible; }
    get fillLightIntensity(): number {
        return this.finished ? 0.14 : Math.sin(Math.min(1, this.time / 0.4) * Math.PI / 2)
            * (1 - THREE.MathUtils.smoothstep(this.time, T.image, 3.05)) * 2.8;
    }

    /** Cheap native depth materials share the exact transforms and opening clip plane. */
    withFogDepth<T>(render: () => T): T {
        const objects = [this.frost, this.transformation.root];
        const visibility = objects.map(object => object.visible);
        const meshes = [...this.crowns, this.shards];
        const materials = meshes.map(mesh => mesh.material);
        try {
            objects.forEach(object => { object.visible = false; });
            // MeshDepthMaterial has no transmission, so this pass never renders a refraction buffer.
            meshes.forEach(mesh => { (mesh as THREE.Mesh).material = this.depthMaterial; });
            return render();
        } finally {
            objects.forEach((object, i) => { object.visible = visibility[i]; });
            meshes.forEach((mesh, i) => { mesh.material = materials[i]; });
        }
    }
    async compileFogDepth(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene): Promise<void> {
        await this.withFogDepth(() => renderer.compileAsync(this.root, camera, scene));
    }
    get fogDepthRevision(): string { return this.finished || this.time >= T.fade ? 'finished' : String(this.time); }
    setActive(active: boolean): void {
        this.root.visible = active;
        this.transformation.setActive(active);
    }
    addToTimeline(timeline: gsap.core.Timeline): void { this.transformation.addToTimeline(timeline); }

    update(time: number, _viewportHeight: number): void {
        this.time = time;
        this.transformation.update(time);
        this.root.updateWorldMatrix(true, false);
        this.lighting.position.value.copy(this.fillLightPosition).applyMatrix4(this.root.matrixWorld);
        this.lighting.energy.value = THREE.MathUtils.smoothstep(time, 0.15, 0.9)
            * (1 - THREE.MathUtils.smoothstep(time, T.image, 3.05));
        this.floor.copy(this.localFloor).applyMatrix4(this.root.matrixWorld);
        this.frost.visible = !this.finished && time > 0 && time < T.fade;
        this.frost.material.uniforms.uTime.value = time;
        this.crown.visible = !this.finished && time >= ICE.start && time < ICE.hidden;
        this.poses.forEach(pose => {
            const emergence = THREE.MathUtils.smoothstep(time, pose.birth, ICE.grown);
            const retreat = THREE.MathUtils.smoothstep(time, pose.retract, pose.retract + pose.duration);
            const extension = emergence * (1 - retreat);
            this.dummy.position.copy(pose.base).addScaledVector(pose.axis, -(1 - extension) * (pose.scale.y + 0.08));
            this.dummy.quaternion.copy(pose.rotation);
            this.dummy.scale.copy(pose.scale);
            this.dummy.updateMatrix();
            this.crowns[pose.variant].setMatrixAt(pose.instance, this.dummy.matrix);
        });
        this.crowns.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
        let liveShards = 0;
        for (let i = 0; i < this.shards.count; i++) {
            const pose = this.poses[i % this.largeCount];
            const age = time - pose.birth - 0.035;
            const life = 0.66 + i % 4 * 0.06;
            const alive = age > 0 && age < life;
            if (alive) liveShards++;
            const angle = i * 2.39996;
            this.dummy.position.copy(pose.base);
            this.dummy.position.x += Math.cos(angle) * age * (0.22 + i % 3 * 0.08);
            this.dummy.position.y += 0.045 + age * (1.25 + i % 4 * 0.13) - age * age * 1.8;
            this.dummy.position.z += Math.sin(angle) * age * 0.32;
            if (!alive) this.dummy.position.y = -10;
            this.dummy.rotation.set(i + age * 2.1, i * 2 + age, i * 0.7 + age * 3);
            this.dummy.scale.setScalar(alive ? (0.03 + i % 3 * 0.012)
                * (1 - THREE.MathUtils.smoothstep(age, life * 0.75, life)) : 0.00001);
            this.dummy.updateMatrix();
            this.shards.setMatrixAt(i, this.dummy.matrix);
        }
        this.shards.visible = !this.finished && liveShards > 0;
        this.shards.instanceMatrix.needsUpdate = true;
    }
    reset(): void {
        this.finished = false;
        this.transformation.reset();
        this.update(0, 0);
    }
    finish(): void {
        this.finished = true;
        this.transformation.finish();
        this.crown.visible = this.shards.visible = this.frost.visible = false;
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        this.transformation.dispose();
        this.crowns.forEach(mesh => { mesh.material.dispose(); mesh.geometry.dispose(); mesh.dispose(); });
        this.shards.material.dispose();
        this.depthMaterial.dispose();
        this.shards.geometry.dispose();
        this.shards.dispose();
        this.reflection.dispose();
        this.frost.geometry.dispose();
        this.frost.material.dispose();
    }
}
