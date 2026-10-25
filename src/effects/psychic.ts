import * as THREE from 'three';
import { CardManifestation } from './cardManifestation';
import type { PokemonRevealEffect } from './types';

const TAU = Math.PI * 2;

const ribbonVertex = /* glsl */ `
    uniform float uTime;
    uniform float uPhase;
    uniform float uKind;
    uniform float uHeight;
    uniform float uRadius;
    uniform float uTilt;
    uniform float uEllipse;
    attribute float aT;
    attribute float aSide;
    varying float vT;
    varying float vSide;
    varying float vNoise;

    void main() {
        float t = aT;
        float angle;
        vec3 center;
        vec3 across;
        float width;
        if (uKind < 0.5) {
            angle = t * 14.5 + uTime * 1.55 + uPhase;
            angle += 0.16 * sin(t * 24.0 + uTime * 2.1 + uPhase);
            float radius = mix(0.07, 0.56, t) + 0.045 * sin(t * 27.0 - uTime * 2.4 + uPhase);
            center = vec3(radius * cos(angle), 0.01 + t * 1.48, 0.15 + radius * sin(angle) * 0.62);
            across = normalize(vec3(cos(angle + 1.57), 0.24 * sin(angle * 1.7), sin(angle + 1.57) * 0.27));
            width = (0.085 + 0.09 * sin(t * 3.14159)) * (0.74 + 0.26 * sin(t * 35.0 + uTime * 3.0 + uPhase));
        } else {
            angle = t * 6.2831853 + uTime * (0.26 + 0.09 * uPhase) + uPhase;
            float wobble = 1.0 + 0.034 * sin(t * 23.0 - uTime * 1.8 + uPhase);
            center = vec3(uRadius * cos(angle) * wobble,
                uHeight + uTilt * sin(angle) + 0.035 * sin(t * 17.0 + uTime * 1.4 + uPhase),
                0.18 + uRadius * uEllipse * sin(angle) * wobble);
            across = normalize(vec3(0.15 * cos(angle), 1.0, 0.12 * sin(angle)));
            width = 0.047 + 0.028 * (0.5 + 0.5 * sin(t * 29.0 + uPhase));
        }
        vec3 pos = center + across * aSide * width;
        vT = t;
        vSide = aSide;
        vNoise = sin(t * 37.0 + uTime * 2.3 + uPhase) * sin(t * 19.0 - uTime + uPhase);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const ribbonFragment = /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uReveal;
    uniform float uTime;
    uniform float uPhase;
    uniform float uKind;
    varying float vT;
    varying float vSide;
    varying float vNoise;

    void main() {
        float edge = pow(max(0.0, 1.0 - abs(vSide)), 1.65);
        float hot = pow(max(0.0, 1.0 - abs(vSide) * 3.2), 2.0);
        float flicker = 0.67 + 0.33 * sin(vT * 29.0 - uTime * 3.4 + uPhase) * sin(vT * 13.0 + uTime * 1.3);
        float shape = uKind < 0.5
            ? smoothstep(0.0, 0.10, vT) * (1.0 - smoothstep(0.86, 1.0, vT))
            : (0.08 + 0.92 * smoothstep(-0.30, 0.50, sin(vT * 31.0 + uPhase + uTime)));
        float reveal = uKind < 0.5
            ? 1.0 - smoothstep(uReveal - 0.10, uReveal + 0.04, vT)
            : uReveal;
        float alpha = edge * shape * flicker * reveal * uOpacity * (0.82 + 0.18 * vNoise);
        vec3 color = mix(uColor, vec3(1.0, 0.83, 1.0), hot * 0.78);
        gl_FragColor = vec4(color * 1.18, alpha);
    }
`;

const coreVertex = /* glsl */ `
    uniform float uTime;
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vDisplacement;

    void main() {
        float wave = sin(position.x * 26.0 + uTime * 3.7)
            * sin(position.y * 21.0 - uTime * 2.9)
            * sin(position.z * 23.0 + uTime * 3.1);
        vec3 pos = position + normal * wave * 0.014;
        vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-viewPosition.xyz);
        vDisplacement = wave;
        gl_Position = projectionMatrix * viewPosition;
    }
`;

const coreFragment = /* glsl */ `
    uniform float uOpacity;
    uniform float uTime;
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vDisplacement;

    void main() {
        float facing = max(0.0, dot(normalize(vNormal), normalize(vView)));
        float fresnel = pow(1.0 - facing, 2.1);
        float pulse = 0.88 + 0.12 * sin(uTime * 10.0);
        vec3 color = mix(vec3(0.55, 0.19, 0.91), vec3(1.0, 0.88, 1.0), pow(facing, 0.9));
        color += fresnel * vec3(0.33, 0.17, 0.48) + vDisplacement * 0.06;
        gl_FragColor = vec4(color * pulse, uOpacity);
    }
`;

const glowVertex = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const glowFragment = /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    varying vec2 vUv;
    void main() {
        float d = length(vUv - 0.5) * 2.0;
        float center = exp(-d * d * 11.0);
        float halo = exp(-d * d * 3.5) * 0.28;
        gl_FragColor = vec4(uColor, (center + halo) * uOpacity);
    }
`;

const poolFragment = /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float angle = atan(p.y, p.x);
        float radius = length(p);
        float ripple = 0.035 * sin(angle * 8.0 + uTime * 1.7) + 0.025 * sin(angle * 13.0 - uTime);
        float center = exp(-radius * radius * 13.0);
        float ring = exp(-pow((radius - 0.42 - ripple) * 19.0, 2.0));
        float outer = exp(-pow((radius - 0.70 + ripple) * 13.0, 2.0));
        float fade = 1.0 - smoothstep(0.75, 1.0, radius);
        gl_FragColor = vec4(uColor, (center * 0.55 + ring * 0.64 + outer * 0.20) * fade * uOpacity);
    }
`;

const auraFragment = /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uPhase;
    varying vec2 vUv;
    void main() {
        vec2 uvCentered = (vUv - 0.5) * 2.0;
        vec2 p = uvCentered;
        p.x *= 0.88;
        float envelope = exp(-dot(p, p) * 2.2);
        float warp = sin(p.y * 5.0 - uTime * 0.9 + uPhase) * 0.27;
        float fold = sin((p.x + warp) * 10.0 + p.y * 3.0 + uTime * 1.4);
        float fine = sin(p.x * 19.0 - p.y * 12.0 + uTime * 2.3 + uPhase);
        float veil = smoothstep(-0.35, 0.70, fold) * (0.53 + 0.47 * smoothstep(-0.5, 0.7, fine));
        float bounds = 1.0 - smoothstep(0.62, 0.98, max(abs(uvCentered.x), abs(uvCentered.y)));
        float alpha = envelope * (0.18 + 0.82 * veil) * bounds * uOpacity * 0.48;
        gl_FragColor = vec4(uColor, alpha);
    }
`;

const particleVertex = /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform float uViewportHeight;
    attribute vec4 aParticle;
    varying float vAlpha;
    varying float vHue;

    void main() {
        float life = fract(aParticle.x + uTime * aParticle.y * 0.24);
        float angle = aParticle.z + life * 8.0 + uTime * 0.7;
        float radius = 0.13 + life * 0.55 + 0.08 * sin(aParticle.z * 4.0);
        vec3 pos = vec3(cos(angle) * radius, 0.03 + life * 1.62, 0.15 + sin(angle) * radius * 0.62);
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(18.0, aParticle.w * uViewportHeight / max(0.1, -mv.z));
        vAlpha = (1.0 - smoothstep(0.42, 1.0, life)) * uOpacity * (0.65 + 0.35 * sin(uTime * 8.0 + aParticle.z * 7.0));
        vHue = aParticle.x;
    }
`;

const particleFragment = /* glsl */ `
    varying float vAlpha;
    varying float vHue;
    void main() {
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float d = length(p);
        float alpha = exp(-d * d * 5.0) * vAlpha;
        vec3 color = mix(vec3(0.62, 0.37, 1.0), vec3(1.0, 0.49, 0.91), vHue);
        color = mix(color, vec3(1.0, 0.9, 1.0), exp(-d * d * 16.0));
        gl_FragColor = vec4(color, alpha);
    }
`;

function makeStrip(segments: number, acrossSegments: number): THREE.BufferGeometry {
    const count = (segments + 1) * (acrossSegments + 1);
    const positions = new Float32Array(count * 3);
    const tValues = new Float32Array(count);
    const sides = new Float32Array(count);
    const indices: number[] = [];

    for (let i = 0; i <= segments; i++) {
        for (let j = 0; j <= acrossSegments; j++) {
            const index = i * (acrossSegments + 1) + j;
            tValues[index] = i / segments;
            sides[index] = j / acrossSegments * 2 - 1;
            if (i < segments && j < acrossSegments) {
                const next = index + acrossSegments + 1;
                indices.push(index, next, index + 1, index + 1, next, next + 1);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(tValues, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.72, 0), 2.2);
    return geometry;
}

/** Procedural, texture-free Psychic VFX attached to the Poké Ball opening. */
export class PsychicEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly state = { core: 0, burst: 0, vortex: 0, rings: 0, particles: 0, morph: 0, silhouette: 0, cardImage: 0, corners: 0, fade: 1 };
    private readonly dynamicRoot = new THREE.Group();
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly materials: THREE.Material[] = [];
    private readonly shaderMaterials: THREE.ShaderMaterial[] = [];
    private readonly core: THREE.Mesh;
    private readonly crystals: THREE.InstancedMesh;
    private readonly crystalMaterial: THREE.MeshBasicMaterial;
    private readonly crystalDummy = new THREE.Object3D();
    private readonly manifestation: CardManifestation;
    private finished = false;

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'PsychicEffect';
        this.root.add(this.dynamicRoot);
        this.manifestation = new CardManifestation(card);
        this.addPool();
        const coreMaterial = this.shader({ uTime: { value: 0 }, uOpacity: { value: 0 } }, coreVertex, coreFragment, false, true);
        const coreGeometry = new THREE.SphereGeometry(0.13, mobile ? 20 : 32, mobile ? 14 : 24);
        this.core = new THREE.Mesh(coreGeometry, coreMaterial);
        this.core.position.set(0, -0.07, 0.26);
        this.dynamicRoot.add(this.core);
        this.geometries.push(coreGeometry);

        this.addGlow(-0.05, 0.30, 0.82, 0xefa4ff, false);
        this.addGlow(-0.10, 0.14, 1.30, 0xa855f7, true);
        this.addAura(0.74, 0.16, 1.96, 0xa855f7, 0);
        if (!mobile) this.addAura(0.88, 0.32, 1.82, 0xff4ddb, 2.1);

        const vortexGeometry = makeStrip(mobile ? 112 : 176, 6);
        const ringGeometry = makeStrip(mobile ? 100 : 160, 6);
        this.geometries.push(vortexGeometry, ringGeometry);
        [0, 1, 2].forEach((i) => {
            const material = this.ribbonMaterial(0, i * 2.13, 0, 0, 0, 0.62, [0xe879f9, 0xa855f7, 0xff4ddb][i]);
            this.dynamicRoot.add(new THREE.Mesh(vortexGeometry, material));
        });
        [0, 1, 2].forEach((i) => {
            const material = this.ribbonMaterial(1, i * 1.95, 0.40 + i * 0.30, 0.92 + i * 0.13, [0.13, -0.32, 0.26][i], [0.46, 0.57, 0.70][i], [0xff4ddb, 0xe879f9, 0x818cf8][i]);
            this.dynamicRoot.add(new THREE.Mesh(ringGeometry, material));
        });

        const particleCount = mobile ? 54 : 102;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const particles = new Float32Array(particleCount * 4);
        for (let i = 0; i < particleCount; i++) {
            const offset = i * 4;
            particles[offset] = (i * 0.61803398875) % 1;
            particles[offset + 1] = 0.62 + (i * 0.38196601125) % 0.65;
            particles[offset + 2] = (i * 2.3999632297) % TAU;
            particles[offset + 3] = 0.013 + (i % 7) * 0.0034;
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aParticle', new THREE.BufferAttribute(particles, 4));
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 2.1);
        this.geometries.push(geometry);
        const particleMaterial = this.shader({
            uTime: { value: 0 }, uOpacity: { value: 0 }, uViewportHeight: { value: 800 },
        }, particleVertex, particleFragment, true, true);
        this.dynamicRoot.add(new THREE.Points(geometry, particleMaterial));

        const crystalGeometry = new THREE.OctahedronGeometry(1, 0);
        const facetColors = new Float32Array(crystalGeometry.getAttribute('position').count * 3);
        const facetBrightness = [1.0, 0.38, 0.82, 0.32, 0.64, 0.96, 0.45, 0.76];
        for (let i = 0; i < facetColors.length / 3; i++) {
            const brightness = facetBrightness[Math.floor(i / 3) % facetBrightness.length];
            facetColors.set([brightness, brightness * 0.82, 1.0], i * 3);
        }
        crystalGeometry.setAttribute('color', new THREE.BufferAttribute(facetColors, 3));
        this.crystalMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff, vertexColors: true, transparent: true, opacity: 0,
            blending: THREE.NormalBlending, depthTest: true, depthWrite: false,
            side: THREE.FrontSide, toneMapped: false,
        });
        this.crystals = new THREE.InstancedMesh(crystalGeometry, this.crystalMaterial, mobile ? 6 : 12);
        this.crystals.frustumCulled = false;
        this.crystals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.root.add(this.crystals);
        this.geometries.push(crystalGeometry);
        this.materials.push(this.crystalMaterial);
        const crystalColors = [0xe879f9, 0xf0abfc, 0xa78bfa, 0xff70e8];
        for (let i = 0; i < this.crystals.count; i++) {
            this.crystals.setColorAt(i, new THREE.Color(crystalColors[i % crystalColors.length]));
        }
        if (this.crystals.instanceColor) this.crystals.instanceColor.needsUpdate = true;
        this.updateCrystals(0);
    }

    /** Updates all faceted shards in one instanced draw call. */
    private updateCrystals(time: number): void {
        const strength = this.state.morph * this.state.particles;
        this.crystals.visible = strength > 0.001 && this.state.fade > 0.001;
        this.crystalMaterial.opacity = strength * this.state.fade * 0.88;
        for (let i = 0; i < this.crystals.count; i++) {
            const phase = i * 2.3999632297;
            const side = i % 2 === 0 ? -1 : 1;
            const spread = 0.58 + (i % 3) * 0.12;
            const height = 0.30 + ((i * 5) % 11) / 11 * 1.05;
            this.crystalDummy.position.set(
                side * spread + Math.sin(time * 1.3 + phase) * 0.06,
                height + Math.sin(time * 1.7 + phase) * 0.07,
                0.23 + Math.sin(phase * 0.7) * 0.17,
            );
            this.crystalDummy.rotation.set(
                0.28 + Math.sin(phase + time * 0.8) * 0.18,
                0.35 + phase * 0.18 + time * 0.5,
                phase * 0.45 + time * 0.5,
            );
            const size = Math.min(1, strength * 1.8) * this.state.fade;
            this.crystalDummy.scale.set(
                (0.034 + i % 3 * 0.009) * size,
                (0.065 + i % 4 * 0.011) * size,
                (0.030 + i % 2 * 0.008) * size,
            );
            this.crystalDummy.updateMatrix();
            this.crystals.setMatrixAt(i, this.crystalDummy.matrix);
        }
        this.crystals.instanceMatrix.needsUpdate = true;
    }

    private shader(uniforms: THREE.ShaderMaterialParameters['uniforms'], vertexShader: string, fragmentShader: string, additive: boolean, depthTest = false): THREE.ShaderMaterial {
        const material = new THREE.ShaderMaterial({
            uniforms, vertexShader, fragmentShader,
            transparent: true,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            depthTest,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        this.materials.push(material);
        this.shaderMaterials.push(material);
        return material;
    }

    private addPool(): void {
        const geometry = new THREE.PlaneGeometry(1.62, 1.62);
        const material = this.shader({
            uColor: { value: new THREE.Color(0xe879f9).convertLinearToSRGB() },
            uOpacity: { value: 0 }, uTime: { value: 0 }, uPool: { value: 1 },
        }, glowVertex, poolFragment, true);
        const pool = new THREE.Mesh(geometry, material);
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(0, -0.08, 0.14);
        this.root.add(pool);
        this.geometries.push(geometry);
    }

    private addGlow(y: number, z: number, size: number, color: THREE.ColorRepresentation, horizontal: boolean): void {
        const geometry = new THREE.PlaneGeometry(size, size);
        const material = this.shader({ uColor: { value: new THREE.Color(color).convertLinearToSRGB() }, uOpacity: { value: 0 } }, glowVertex, glowFragment, true);
        const glow = new THREE.Mesh(geometry, material);
        glow.position.set(0, y, z);
        if (horizontal) glow.rotation.x = -Math.PI / 2;
        this.dynamicRoot.add(glow);
        this.geometries.push(geometry);
    }

    private addAura(y: number, z: number, size: number, color: THREE.ColorRepresentation, phase: number): void {
        const geometry = new THREE.PlaneGeometry(size, size);
        const material = this.shader({
            uColor: { value: new THREE.Color(color).convertLinearToSRGB() },
            uOpacity: { value: 0 }, uTime: { value: 0 }, uPhase: { value: phase }, uAura: { value: 1 },
        }, glowVertex, auraFragment, false);
        const aura = new THREE.Mesh(geometry, material);
        aura.position.set(0, y, z);
        this.dynamicRoot.add(aura);
        this.geometries.push(geometry);
    }

    private ribbonMaterial(kind: number, phase: number, height: number, radius: number, tilt: number, ellipse: number, color: THREE.ColorRepresentation): THREE.ShaderMaterial {
        return this.shader({
            uTime: { value: 0 }, uPhase: { value: phase }, uKind: { value: kind },
            uHeight: { value: height }, uRadius: { value: radius }, uTilt: { value: tilt }, uEllipse: { value: ellipse },
            uColor: { value: new THREE.Color(color).convertLinearToSRGB() }, uOpacity: { value: 0 }, uReveal: { value: 0 },
        }, ribbonVertex, ribbonFragment, true, true);
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        timeline.to(this.state, { core: 1, duration: 0.4, ease: 'power2.out' }, 0);
        timeline.to(this.state, { burst: 1, duration: 0.4, ease: 'power3.out' }, 0.4);
        timeline.to(this.state, { vortex: 0.28, particles: 0.25, duration: 0.4, ease: 'power2.out' }, 0.4);
        timeline.to(this.state, { vortex: 1, rings: 1, particles: 1, duration: 0.65, ease: 'power2.out' }, 0.8);
        timeline.to(this.state, { morph: 1, silhouette: 1, duration: 0.70, ease: 'power2.inOut' }, 1.45);
        timeline.to(this.state, { corners: 1, duration: 0.35, ease: 'power2.out' }, 1.70);
        timeline.to(this.state, { cardImage: 1, duration: 0.70, ease: 'power2.inOut' }, 2.15);
        timeline.to(this.state, { fade: 0, duration: 0.65, ease: 'power2.inOut' }, 2.85);
    }

    update(time: number, viewportHeight: number): void {
        const intensity = this.state.fade;
        this.core.scale.setScalar(0.72 + this.state.burst * 0.35 + Math.sin(time * 11) * 0.055);
        for (const material of this.shaderMaterials) {
            const { uniforms } = material;
            if (uniforms.uTime) uniforms.uTime.value = time;
            if (uniforms.uViewportHeight) uniforms.uViewportHeight.value = viewportHeight;
            if (uniforms.uKind) {
                const ring = uniforms.uKind.value > 0.5;
                const cardReadability = 1
                    - this.state.morph * (ring ? 0.16 : 0.26)
                    - this.state.cardImage * (ring ? 0.35 : 0.48);
                uniforms.uOpacity.value = (ring ? this.state.rings : this.state.burst)
                    * intensity * cardReadability * (ring ? 1.08 : 0.96);
                uniforms.uReveal.value = ring ? this.state.rings : this.state.vortex;
            } else if (uniforms.uPool) {
                uniforms.uOpacity.value = (this.state.core * 0.66 + this.state.burst * 0.43) * intensity;
            } else if (uniforms.uAura) {
                uniforms.uOpacity.value = this.state.vortex * intensity;
            } else if (uniforms.uColor) {
                uniforms.uOpacity.value = (this.state.core * 0.65 + this.state.burst * 0.36)
                    * intensity * (1 - this.state.morph * 0.5);
            } else if (uniforms.uViewportHeight) {
                uniforms.uOpacity.value = this.state.particles * intensity;
            } else {
                uniforms.uOpacity.value = this.state.core * intensity * (1 - this.state.morph);
            }
        }
        this.manifestation.update(
            time,
            this.state.morph,
            this.finished ? 0 : this.state.silhouette * intensity * (1 - this.state.cardImage),
            1 - this.state.cardImage,
            this.finished ? 0 : this.state.corners,
            this.state.cardImage,
        );
        this.updateCrystals(time);
    }

    reset(): void {
        this.finished = false;
        this.dynamicRoot.visible = true;
        Object.assign(this.state, { core: 0, burst: 0, vortex: 0, rings: 0, particles: 0, morph: 0, silhouette: 0, cardImage: 0, corners: 0, fade: 1 });
        this.update(0, 800);
    }

    finish(): void {
        this.finished = true;
        this.dynamicRoot.visible = false;
    }

    dispose(): void {
        this.root.removeFromParent();
        this.manifestation.dispose();
        this.geometries.forEach((geometry) => geometry.dispose());
        this.materials.forEach((material) => material.dispose());
    }
}
