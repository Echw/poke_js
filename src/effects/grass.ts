import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import type { PokemonRevealEffect } from './types';

const TAU = Math.PI * 2;

const ribbonVertex = /* glsl */ `
    uniform float uTime;
    uniform float uMobile;
    attribute float aT;
    attribute float aSide;
    attribute float aRibbon;
    attribute float aStrand;
    varying float vT;
    varying float vSide;
    varying float vRibbon;
    varying float vX;
    varying float vDepth;
    varying float vStrand;
    void main() {
        float t = aT;
        float angle;
        float radius;
        float height;
        float width;
        if (aRibbon < 0.5) {
            angle = t * 14.1 + uTime * 0.88 + 0.17 * sin(t * 22.0 - uTime * 1.2);
            radius = mix(0.07, 0.56, t) + 0.055 * sin(t * 24.0 + uTime);
            height = -0.07 + t * 1.47 + 0.06 * sin(t * 11.0 + uTime) * t;
            width = (0.08 + 0.08 * sin(t * 3.14159))
                * (0.78 + 0.22 * sin(t * 29.0 - uTime * 2.0));
        } else if (aRibbon < 1.5) {
            angle = t * 10.8 + uTime * 0.38 - 1.8 + 0.14 * sin(t * 15.0 - uTime);
            radius = (mix(0.22, 1.05, smoothstep(0.02, 0.34, t))
                * (0.95 + 0.05 * sin(t * 17.0 - uTime * 0.7)))
                * mix(1.0, 0.84, uMobile);
            height = -0.09 + t * 0.32 + 0.11 * sin(t * 9.0 + uTime * 0.7);
            width = 0.09 + 0.055 * sin(t * 3.14159);
        } else {
            angle = t * 12.4 - uTime * 0.48 + 0.9 + 0.17 * sin(t * 16.0 + uTime);
            radius = mix(0.16, 0.78, smoothstep(0.03, 0.67, t))
                * (0.92 + 0.08 * sin(t * 17.0 + uTime * 0.45));
            height = 0.01 + t * 1.20 + 0.12 * sin(t * 9.0 - uTime * 0.6);
            width = 0.075 + 0.055 * sin(t * 3.14159);
        }
        angle += aStrand * (aRibbon < 0.5 ? 2.08 : aRibbon < 1.5 ? 0.56 : -0.53);
        radius *= 1.0 + aStrand * (aRibbon < 0.5 ? 0.04 : 0.055);
        height += aStrand * (aRibbon < 0.5 ? 0.018 : 0.050);
        if (aRibbon > 0.5 && aRibbon < 1.5) height += 0.22 * sin(angle + 0.30);
        if (aRibbon > 1.5) height += 0.11 * sin(angle - 0.45);
        float endWidth = smoothstep(0.0, 0.16, t)
            * (1.0 - smoothstep(0.78, 1.0, t));
        width *= (aStrand < 0.5 ? 1.0 : 0.72) * 1.35 * endWidth;
        vec3 center = vec3(radius * cos(angle), height,
            (aRibbon < 0.5 ? 0.68 : 0.50)
                + radius * sin(angle) * (aRibbon < 0.5 ? 0.35 : 0.38));
        vec3 across = aRibbon < 0.5
            ? normalize(vec3(cos(angle + 1.57), 0.22 * sin(angle * 1.7),
                sin(angle + 1.57) * 0.28))
            : normalize(vec3(0.48 * cos(angle), 0.78 + 0.12 * sin(angle * 1.6),
                0.10 * sin(angle)));
        vec3 point = center + across * aSide * width;
        vT = t;
        vSide = aSide;
        vRibbon = aRibbon;
        vX = point.x;
        vDepth = center.z;
        vStrand = aStrand;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
    }
`;

const ribbonFragment = /* glsl */ `
    uniform vec3 uGreen;
    uniform vec3 uLime;
    uniform vec3 uHot;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uMorph;
    uniform float uImage;
    varying float vT;
    varying float vSide;
    varying float vRibbon;
    varying float vX;
    varying float vDepth;
    varying float vStrand;
    void main() {
        float soft = pow(max(0.0, 1.0 - abs(vSide)), 2.45);
        float center = pow(max(0.0, 1.0 - abs(vSide) * 3.4), 2.0);
        float taper = smoothstep(0.0, vRibbon > 1.5 ? 0.23 : 0.11, vT)
            * (1.0 - smoothstep(0.84, 1.0, vT));
        float wave = sin(vT * 27.0 - uTime * 2.3 + vRibbon * 2.5)
            + 0.45 * sin(vT * 13.0 + uTime * 1.1 - vRibbon);
        float flow = 0.20 + 0.80 * smoothstep(-0.55, 0.72, wave);
        float depth = mix(0.50, 1.0, smoothstep(-0.35, 0.92, vDepth));
        float activity = vRibbon < 0.5 ? 1.0 - uMorph * 0.90
            : vRibbon < 1.5 ? 1.0 : 1.0 - uMorph * 0.20;
        if (vRibbon > 0.5) {
            float cardClearance = mix(0.22, 1.0, smoothstep(0.38, 0.65, abs(vX)));
            activity *= mix(1.0, cardClearance, uImage);
        }
        float alpha = (soft * 0.045 + center * 0.76) * taper * flow * depth
            * uOpacity * max(0.0, activity) * (vStrand < 0.5 ? 0.90 : 0.50)
            * (vRibbon < 0.5 ? 1.55 : 1.0);
        alpha *= 1.0 - smoothstep(1.05, 1.47, abs(vX));
        vec3 color = mix(uGreen, uLime, soft * 0.82);
        color = mix(color, uHot, center * 0.85);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const particleVertex = /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform float uViewportHeight;
    attribute vec4 aParticle;
    attribute float aRoute;
    varying float vAlpha;
    void main() {
        float life = fract(aParticle.x + uTime * aParticle.y * 0.15);
        float angle = aParticle.z + life * 2.3 + uTime * 0.22;
        float radius = aRoute < 0.5 ? 0.10 + life * 0.43
            : aRoute < 1.5 ? 0.36 + life * 0.75 : 0.42 + life * 0.66;
        float height = aRoute < 0.5 ? -0.04 + life * 1.46
            : aRoute < 1.5 ? -0.03 + life * 0.43 : 0.42 + life * 0.76;
        vec3 pos = vec3(cos(angle) * radius, height,
            0.30 + sin(angle) * radius * 0.30);
        vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = min(13.0, aParticle.w * uViewportHeight / max(0.1, -viewPosition.z));
        vAlpha = (1.0 - smoothstep(0.55, 1.0, life)) * uOpacity
            * (0.76 + 0.24 * sin(uTime * 5.0 + aParticle.z * 4.0));
    }
`;

const particleFragment = /* glsl */ `
    uniform vec3 uGreen;
    uniform vec3 uHot;
    varying float vAlpha;
    void main() {
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float d = length(p);
        float alpha = exp(-d * d * 5.5) * vAlpha;
        vec3 color = mix(uGreen, uHot, exp(-d * d * 17.0));
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const leafVertex = /* glsl */ `
    attribute vec4 aLeafVariation;
    varying vec2 vUv;
    varying vec2 vLeafUv;
    varying float vFacing;
    varying float vVariation;
    void main() {
        vLeafUv = vec2(aLeafVariation.z > 0.5 ? 1.0 - uv.x : uv.x, uv.y);
        vUv = vec2((aLeafVariation.w + vLeafUv.x) / 3.0, vLeafUv.y);
        vVariation = aLeafVariation.z;
        vec3 leafPosition = position;
        leafPosition.x *= aLeafVariation.x;
        leafPosition.y *= aLeafVariation.y;
        leafPosition.z += position.x * (aLeafVariation.z - 0.5) * 0.07;
        vec3 viewNormal = normalize(mat3(modelViewMatrix * instanceMatrix) * normal);
        vFacing = abs(viewNormal.z);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(leafPosition, 1.0);
    }
`;

const leafFragment = /* glsl */ `
    uniform sampler2D uMap;
    uniform float uOpacity;
    uniform float uTime;
    varying vec2 vUv;
    varying vec2 vLeafUv;
    varying float vFacing;
    varying float vVariation;
    void main() {
        vec4 texel = texture2D(uMap, vUv);
        float body = smoothstep(0.18, 0.76, texel.a);
        float halo = texel.a * (1.0 - body);
        float midribX = mix(0.45, 0.75, vLeafUv.y);
        float midrib = exp(-pow((vLeafUv.x - midribX) * 23.0, 2.0))
            * smoothstep(0.10, 0.36, vLeafUv.y) * (1.0 - smoothstep(0.90, 1.0, vLeafUv.y));
        float pulse = 0.91 + 0.09 * sin(uTime * 4.2 + vLeafUv.y * 7.0);
        vec3 lit = mix(texel.rgb, vec3(0.48, 0.88, 0.20), 0.08 + midrib * 0.28);
        lit += vec3(0.02, 0.05, 0.0) * body + vec3(0.28, 0.55, 0.06) * halo;
        lit *= mix(vec3(0.82, 1.0, 0.78), vec3(1.0, 0.92, 0.72), vVariation);
        float alpha = texel.a * uOpacity * pulse * (0.72 + 0.28 * vFacing);
        if (alpha < 0.012) discard;
        gl_FragColor = vec4(lit, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

function makeRibbons(count: number, strands: number): THREE.BufferGeometry {
    const segments = 96;
    const across = 4;
    const verticesPerRibbon = (segments + 1) * (across + 1);
    const bands = count * strands;
    const positions = new Float32Array(bands * verticesPerRibbon * 3);
    const times = new Float32Array(bands * verticesPerRibbon);
    const sides = new Float32Array(bands * verticesPerRibbon);
    const ribbons = new Float32Array(bands * verticesPerRibbon);
    const strandIds = new Float32Array(bands * verticesPerRibbon);
    const indices: number[] = [];
    for (let band = 0; band < bands; band++) {
        const ribbon = Math.floor(band / strands);
        const strand = band % strands;
        for (let segment = 0; segment <= segments; segment++) {
            for (let side = 0; side <= across; side++) {
                const index = band * verticesPerRibbon + segment * (across + 1) + side;
                times[index] = segment / segments;
                sides[index] = side / across * 2 - 1;
                ribbons[index] = ribbon;
                strandIds[index] = strand;
                if (segment < segments && side < across) {
                    const next = index + across + 1;
                    indices.push(index, next, index + 1, index + 1, next, next + 1);
                }
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(times, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    geometry.setAttribute('aRibbon', new THREE.BufferAttribute(ribbons, 1));
    geometry.setAttribute('aStrand', new THREE.BufferAttribute(strandIds, 1));
    geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 3.0);
    return geometry;
}

function makeLeaf(): { geometry: THREE.PlaneGeometry; texture: THREE.CanvasTexture } {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 192;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Grass leaf canvas unavailable');
    const leafShapes = [
        [31, 149, 14, 111, 30, 72, 44, 36, 76, 28, 96, 15,
            112, 57, 114, 95, 91, 131, 79, 151, 67, 165, 58, 176],
        [39, 146, 27, 111, 38, 75, 49, 40, 77, 24, 93, 13,
            100, 56, 101, 95, 83, 134, 72, 152, 65, 166, 58, 176],
        [22, 152, 12, 113, 24, 78, 38, 43, 67, 38, 84, 23,
            116, 51, 119, 101, 92, 136, 78, 156, 67, 169, 58, 176],
    ];
    for (let variant = 0; variant < leafShapes.length; variant++) {
        context.save();
        context.translate(variant * 128, 0);
        const shape = leafShapes[variant];
        const contour = new Path2D();
        contour.moveTo(58, 176);
        for (let point = 0; point < shape.length; point += 6) {
            contour.bezierCurveTo(shape[point], shape[point + 1], shape[point + 2],
                shape[point + 3], shape[point + 4], shape[point + 5]);
        }
        const color = context.createLinearGradient(25, 75, 107, 100);
        color.addColorStop(0, variant === 1 ? '#d5ff8b' : '#b7f76a');
        color.addColorStop(0.42, variant === 2 ? '#6ac938' : '#78d83e');
        color.addColorStop(1, '#277a28');
        context.shadowColor = 'rgba(135, 255, 75, 0.78)';
        context.shadowBlur = 19;
        context.fillStyle = color;
        context.fill(contour);
        context.shadowBlur = 0;
        context.save();
        context.clip(contour);
        const innerLight = context.createRadialGradient(64, 95, 3, 64, 95, 78);
        innerLight.addColorStop(0, 'rgba(245, 255, 185, 0.12)');
        innerLight.addColorStop(1, 'rgba(180, 255, 105, 0)');
        context.fillStyle = innerLight;
        context.fillRect(15, 15, 105, 160);
        context.restore();
        context.strokeStyle = 'rgba(211, 255, 158, 0.40)';
        context.lineWidth = 2;
        context.stroke(contour);
        context.beginPath();
        context.moveTo(57, 174);
        context.bezierCurveTo(62, 125, variant === 1 ? 70 : 75, 69,
            variant === 2 ? 84 : 96, 18);
        context.strokeStyle = 'rgba(220, 255, 148, 0.72)';
        context.lineWidth = 2.4;
        context.stroke();
        for (const [x, y, endX, endY] of [[67, 127, 36, 96], [75, 98, 37, 67], [83, 69, 53, 43],
            [68, 124, 97, 108], [77, 91, 107, 73]]) {
        context.beginPath();
        context.moveTo(x, y);
        context.quadraticCurveTo((x + endX) / 2, y - 9, endX, endY);
        context.strokeStyle = 'rgba(218, 255, 151, 0.32)';
        context.lineWidth = 1.2;
        context.stroke();
        }
        context.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    const geometry = new THREE.PlaneGeometry(0.34, 0.48, 1, 4);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        positions.setZ(i, 0.035 * (1 - Math.abs(y) / 0.24) + 0.025 * x / 0.17);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return { geometry, texture };
}

/** Organic green energy surrounding the shared card transformation. */
export class GrassEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0x79db38);
    readonly fillLightPosition = new THREE.Vector3(0, 0.08, 0.34);
    readonly transformation: CardTransformation;
    readonly state = { ribbons: 0, leaves: 0, particles: 0 };
    private readonly ribbons: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly leaves: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private readonly particles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly leafTexture: THREE.CanvasTexture;
    private readonly leafDummy = new THREE.Object3D();
    private readonly particleCount: number;
    private finished = false;

    get fillLightIntensity(): number {
        const { core, energy, morph, cardImage, fade } = this.transformation.state;
        return (core * 1.3 + energy * 0.8) * (1 - morph * 0.75)
            * fade * (1 - cardImage);
    }

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'GrassEffect';
        this.transformation = new CardTransformation(card, 'grass', mobile);
        this.root.add(this.transformation.root);

        const ribbonMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uOpacity: { value: 0 },
                uMorph: { value: 0 }, uImage: { value: 0 },
                uMobile: { value: mobile ? 1 : 0 },
                uGreen: { value: new THREE.Color(0x4dad34) },
                uLime: { value: new THREE.Color(0xb9f45a) },
                uHot: { value: new THREE.Color(0xf4ffd2) },
            },
            vertexShader: ribbonVertex,
            fragmentShader: ribbonFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            forceSinglePass: true,
            toneMapped: false,
        });
        this.ribbons = new THREE.Mesh(makeRibbons(mobile ? 2 : 3, mobile ? 2 : 3), ribbonMaterial);
        this.root.add(this.ribbons);

        const leaf = makeLeaf();
        this.leafTexture = leaf.texture;
        leaf.geometry.setAttribute('aLeafVariation', new THREE.InstancedBufferAttribute(new Float32Array([
            0.72, 1.04, 0.10, 0,
            1.02, 0.70, 0.70, 1,
            0.80, 0.88, 0.45, 2,
            0.64, 1.16, 0.95, 1,
            0.93, 0.78, 0.25, 0,
            0.76, 1.01, 0.80, 2,
        ]), 4));
        const leafMaterial = new THREE.ShaderMaterial({
            uniforms: { uMap: { value: leaf.texture }, uOpacity: { value: 0 }, uTime: { value: 0 } },
            vertexShader: leafVertex,
            fragmentShader: leafFragment,
            side: THREE.DoubleSide, transparent: true,
            depthTest: true, depthWrite: false,
            forceSinglePass: true,
            toneMapped: false,
        });
        this.leaves = new THREE.InstancedMesh(leaf.geometry, leafMaterial, mobile ? 4 : 6);
        this.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.leaves.frustumCulled = false;
        this.root.add(this.leaves);

        this.particleCount = mobile ? 24 : 42;
        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.particleCount * 3), 3));
        const particleData = new Float32Array(this.particleCount * 4);
        const particleRoutes = new Float32Array(this.particleCount);
        for (let i = 0; i < this.particleCount; i++) {
            const offset = i * 4;
            particleData[offset] = (i * 0.61803398875) % 1;
            particleData[offset + 1] = 0.48 + (i * 0.38196601125) % 0.45;
            particleData[offset + 2] = (i * 2.3999632297) % TAU;
            particleData[offset + 3] = 0.020 + (i % 7) * 0.003;
            particleRoutes[i] = i % 3;
        }
        particleGeometry.setAttribute('aParticle', new THREE.BufferAttribute(particleData, 4));
        particleGeometry.setAttribute('aRoute', new THREE.BufferAttribute(particleRoutes, 1));
        particleGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 2.4);
        const particleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uOpacity: { value: 0 },
                uViewportHeight: { value: 800 },
                uGreen: { value: new THREE.Color(0x77db39) },
                uHot: { value: new THREE.Color(0xe9ffb0) },
            },
            vertexShader: particleVertex,
            fragmentShader: particleFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            toneMapped: false,
        });
        this.particles = new THREE.Points(particleGeometry, particleMaterial);
        this.root.add(this.particles);
        this.root.visible = false;
    }

    setActive(active: boolean): void {
        this.root.visible = active;
        this.transformation.setActive(active);
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        timeline.to(this.state, { particles: 0.25, duration: 0.4, ease: 'power2.out' }, 0);
        timeline.to(this.state, { ribbons: 0.55, leaves: 0.45, duration: 0.4, ease: 'power2.out' }, 0.4);
        timeline.to(this.state, { ribbons: 1, leaves: 1, particles: 1, duration: 0.7, ease: 'power2.out' }, 0.8);
    }

    private updateLeaves(time: number): void {
        const shared = this.transformation.state;
        const opacity = this.state.leaves * shared.fade * (1 - shared.cardImage);
        this.leaves.visible = opacity > 0.001;
        if (!this.leaves.visible) return;
        this.leaves.material.uniforms.uOpacity.value = opacity * 0.96;
        this.leaves.material.uniforms.uTime.value = time;
        for (let i = 0; i < this.leaves.count; i++) {
            const life = (i * 0.61803398875 + time * (0.10 + i % 3 * 0.018)) % 1;
            const phase = i * 2.3999632297;
            const angle = phase + time * 0.28 + life * 1.7;
            const x = (i % 2 === 0 ? -1 : 1)
                * ([0.72, 0.84, 0.96, 0.68, 0.88, 0.79][i] + 0.07 * Math.sin(angle));
            const envelope = 0.42 + 0.58 * Math.min(1, life * 5, (1 - life) * 5);
            const size = [0.72, 0.63, 0.78, 0.67, 0.73, 0.58][i] * envelope;
            this.leafDummy.position.set(
                x,
                -0.03 + life * 1.40,
                0.50 + Math.sin(angle) * 0.12,
            );
            const roll = [0.48, -0.44, 0.12, 0.58, -0.22, -0.55][i];
            this.leafDummy.rotation.set(0.10 * Math.sin(angle), 0.20 * Math.sin(time * 0.7 + phase),
                roll + Math.sin(time * 0.8 + phase) * 0.15);
            this.leafDummy.scale.setScalar(size);
            this.leafDummy.updateMatrix();
            this.leaves.setMatrixAt(i, this.leafDummy.matrix);
        }
        this.leaves.instanceMatrix.needsUpdate = true;
    }

    update(time: number, viewportHeight: number): void {
        const shared = this.transformation.state;
        this.transformation.update(time);
        this.ribbons.material.uniforms.uTime.value = time;
        this.ribbons.material.uniforms.uMorph.value = shared.morph;
        this.ribbons.material.uniforms.uImage.value = shared.cardImage;
        const revealOpacity = this.finished ? 0 : shared.fade * (1 - shared.cardImage);
        this.ribbons.material.uniforms.uOpacity.value = this.state.ribbons * revealOpacity;
        this.ribbons.visible = this.ribbons.material.uniforms.uOpacity.value > 0.001;
        this.particles.material.uniforms.uTime.value = time;
        this.particles.material.uniforms.uViewportHeight.value = viewportHeight;
        this.particles.material.uniforms.uOpacity.value = this.state.particles * revealOpacity;
        this.particles.visible = this.particles.material.uniforms.uOpacity.value > 0.001;
        if (!this.finished) this.updateLeaves(time);
    }

    reset(): void {
        this.finished = false;
        this.transformation.reset();
        Object.assign(this.state, { ribbons: 0, leaves: 0, particles: 0 });
        this.ribbons.visible = true;
        this.leaves.count = this.leaves.instanceMatrix.count;
        this.particles.geometry.setDrawRange(0, this.particleCount);
        this.update(0, 800);
    }

    finish(): void {
        this.finished = true;
        this.transformation.finish();
        this.ribbons.visible = false;
        this.leaves.visible = false;
        this.particles.visible = false;
    }

    dispose(): void {
        this.root.removeFromParent();
        this.transformation.dispose();
        this.ribbons.geometry.dispose();
        this.ribbons.material.dispose();
        this.leaves.geometry.dispose();
        this.leaves.material.dispose();
        this.leafTexture.dispose();
        this.particles.geometry.dispose();
        this.particles.material.dispose();
    }
}
