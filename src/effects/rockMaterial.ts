import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGroundMaterial } from './groundMaterial';

/** Broad fractured hulls, built from asymmetric shoulders rather than round dirt clods. */
export function createRockGeometry(variant: number): THREE.BufferGeometry {
    const points: THREE.Vector3[] = [];
    const phase = variant * 1.73;
    const sides = 7 + variant % 2;
    for (let ring = 0; ring < 3; ring++) {
        for (let side = 0; side < sides; side++) {
            const angle = side / sides * Math.PI * 2 + phase + ring * 0.15;
            const radius = [0.62, 0.91, 0.66][ring] * (0.85 + Math.sin(side * 7.13 + phase + ring) * 0.15);
            points.push(new THREE.Vector3(Math.cos(angle) * radius + ring * 0.06,
                [-0.58, -0.03, 0.55][ring] + Math.sin(side * 3.7 + phase) * 0.10,
                Math.sin(angle) * radius * (variant === 2 ? 0.73 : 0.86)));
        }
    }
    const hull = new ConvexGeometry(points);
    // Subdivide planar breaks only to cut shallow, actual geometric faults.
    const source = hull.getAttribute('position'), vertices: number[] = [];
    const a = new THREE.Vector3(), b = a.clone(), c = a.clone(), p = a.clone();
    const steps = 5;
    const emit = (u: number, v: number) => {
        p.copy(a).multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
        const seam = Math.abs(p.x + p.y * 0.48 + Math.sin(p.z * 7 + phase) * 0.055);
        p.multiplyScalar(1 - (1 - THREE.MathUtils.smoothstep(seam, 0.010, 0.045)) * 0.065);
        vertices.push(p.x, p.y, p.z);
    };
    for (let i = 0; i < source.count; i += 3) {
        a.fromBufferAttribute(source, i); b.fromBufferAttribute(source, i + 1); c.fromBufferAttribute(source, i + 2);
        for (let u = 0; u < steps; u++) for (let v = 0; v < steps - u; v++) {
            emit(u / steps, v / steps); emit((u + 1) / steps, v / steps); emit(u / steps, (v + 1) / steps);
            if (u + v < steps - 1) {
                emit((u + 1) / steps, v / steps); emit((u + 1) / steps, (v + 1) / steps); emit(u / steps, (v + 1) / steps);
            }
        }
    }
    hull.dispose();
    const raw = new THREE.BufferGeometry(); raw.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const geometry = mergeVertices(raw); raw.dispose();
    const positions = geometry.getAttribute('position'), colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
        p.fromBufferAttribute(positions, i);
        const seam = Math.abs(p.x + p.y * 0.48 + Math.sin(p.z * 7 + phase) * 0.055);
        const shade = 0.85 + THREE.MathUtils.smoothstep(seam, 0.015, 0.06) * 0.15;
        colors.set([shade, shade * 0.97, shade * 0.92], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return geometry;
}

/** Ground's triplanar mineral maps, cooled and brightened for exposed fracture faces. */
export function createRockMaterial(floor: THREE.Plane) {
    const soil = createGroundMaterial(floor);
    soil.material.color.set(0xd5ccbe);
    const compile = soil.material.onBeforeCompile;
    soil.material.onBeforeCompile = function (shader, renderer) {
        compile.call(this, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
            'diffuseColor.rgb*=rockSample(uRockColor,rockUV,rockWeights).rgb;',
            `vec3 mineral=rockSample(uRockColor,rockUV,rockWeights).rgb;
            mineral=mix(vec3(dot(mineral,vec3(0.2126,0.7152,0.0722))),mineral,0.30);
            diffuseColor.rgb*=mineral*1.85;
            float fault=abs(vSoil.x+vSoil.y*0.48+sin(vSoil.z*28.0)*0.014);
            diffuseColor.rgb*=mix(0.40,1.0,smoothstep(0.004,0.014,fault));`);
    };
    soil.material.customProgramCacheKey = () => 'rock-fractured-mineral-v1';
    return soil;
}
