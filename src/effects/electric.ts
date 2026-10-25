import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import type { PokemonRevealEffect } from './types';

const SEGMENTS = 18;
const POINTS_PER_PATH = SEGMENTS + 1;
const VERTICES_PER_PATH = POINTS_PER_PATH * 2;
const TAU = Math.PI * 2;
const CARD_EDGE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
    [-0.34, 0.08], [0.34, -0.08], [-0.12, 0.49], [0.12, -0.49],
];

const lightningVertex = /* glsl */ `
    attribute vec3 aTangent;
    attribute float aSide;
    attribute float aT;
    attribute float aWidth;
    attribute float aStrength;
    varying float vSide;
    varying float vT;
    varying float vStrength;
    void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 tangent = normalize(mat3(modelViewMatrix) * aTangent);
        vec2 across = normalize(vec2(-tangent.y, tangent.x) + vec2(0.00001));
        viewPosition.xy += across * aSide * aWidth;
        vSide = aSide;
        vT = aT;
        vStrength = aStrength;
        gl_Position = projectionMatrix * viewPosition;
    }
`;

const lightningFragment = /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform vec3 uGold;
    uniform vec3 uYellow;
    uniform vec3 uWhite;
    varying float vSide;
    varying float vT;
    varying float vStrength;
    void main() {
        float side = abs(vSide);
        float core = 1.0 - smoothstep(0.0, 0.12, side);
        float hot = 1.0 - smoothstep(0.08, 0.58, side);
        float halo = 1.0 - smoothstep(0.32, 1.0, side);
        float ends = smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.88, 1.0, vT));
        float flicker = 0.82 + 0.18 * sin(uTime * 67.0 + vT * 47.0);
        float alpha = (core * 0.68 + hot * 0.42 + halo * 0.24) * ends * flicker * vStrength * uOpacity;
        vec3 color = mix(uGold, uYellow, hot);
        color = mix(color, uWhite, core * 0.82);
        gl_FragColor = vec4(color * (1.0 + core * 0.22), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const sparkVertex = /* glsl */ `
    attribute vec4 aSpark;
    uniform float uTime;
    uniform float uOpacity;
    uniform float uViewportHeight;
    varying float vAlpha;
    varying float vHeat;
    void main() {
        float life = fract(aSpark.x + uTime * aSpark.y * 0.32);
        float angle = aSpark.z;
        float radius = 0.09 + life * (0.65 + aSpark.w * 0.60);
        vec3 pos = vec3(cos(angle) * radius,
            -0.06 + life * (0.55 + aSpark.w * 1.1),
            0.26 + sin(angle) * radius * 0.7);
        vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = min(11.0, (0.013 + aSpark.w * 0.012) * uViewportHeight / max(0.1, -viewPosition.z));
        vAlpha = (1.0 - smoothstep(0.18, 1.0, life)) * uOpacity;
        vHeat = aSpark.w;
    }
`;

const sparkFragment = /* glsl */ `
    uniform vec3 uOrange;
    uniform vec3 uWhite;
    varying float vAlpha;
    varying float vHeat;
    void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = (1.0 - smoothstep(0.15, 1.0, radius)) * vAlpha;
        vec3 color = mix(uOrange, uWhite, (1.0 - radius) * (0.4 + vHeat * 0.6));
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const streakVertex = /* glsl */ `
    attribute vec2 aCorner;
    attribute vec4 aStreak;
    uniform float uTime;
    varying vec2 vCorner;
    varying float vLife;
    void main() {
        float life = fract(aStreak.x + uTime * aStreak.y * 0.48);
        float angle = aStreak.z;
        float travel = 0.14 + life * (0.75 + aStreak.w * 0.60);
        vec3 center = vec3(cos(angle) * travel,
            -0.06 + life * (0.60 + aStreak.w * 0.85),
            0.57 + sin(angle) * travel * 0.35);
        vec4 viewPosition = modelViewMatrix * vec4(center, 1.0);
        vec2 direction = normalize(vec2(cos(angle), 0.75 + sin(angle)));
        vec2 across = vec2(-direction.y, direction.x);
        float length = (0.12 + aStreak.w * 0.12) * (1.0 - life * 0.55);
        float width = 0.014 + aStreak.w * 0.012;
        viewPosition.xy += direction * (aCorner.x - 0.5) * length + across * aCorner.y * width;
        vCorner = aCorner;
        vLife = life;
        gl_Position = projectionMatrix * viewPosition;
    }
`;

const streakFragment = /* glsl */ `
    uniform float uOpacity;
    uniform vec3 uOrange;
    uniform vec3 uWhite;
    varying vec2 vCorner;
    varying float vLife;
    void main() {
        float taper = smoothstep(0.0, 0.18, vCorner.x) * (1.0 - smoothstep(0.65, 1.0, vCorner.x));
        float core = exp(-vCorner.y * vCorner.y * 13.0);
        float alpha = taper * core * (1.0 - vLife) * uOpacity;
        vec3 color = mix(uOrange, uWhite, core * 0.82);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

/** Short, branching electrical discharges attached to the existing Poké Ball and card. */
export class ElectricEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xffd400);
    readonly fillLightPosition = new THREE.Vector3(0, -0.02, 0.40);
    readonly state = { storm: 0, sparks: 0, flash: 0 };
    readonly transformation: CardTransformation;

    get fillLightIntensity(): number {
        const { core, morph, fade, cardImage } = this.transformation.state;
        return (core * (1 - morph) * 2.4
            + this.state.storm * (1 - morph * 0.7) * 0.6
            + this.state.flash * (1 - morph * 0.7) * 1.1) * fade * (1 - cardImage);
    }

    private readonly card: THREE.Mesh;
    private readonly mobile: boolean;
    private readonly maxArcs: number;
    private activeArcs: number;
    private activeBranches = 2;
    private refreshHz: number;
    private readonly pathPoints: Float32Array;
    private readonly positions: Float32Array;
    private readonly tangents: Float32Array;
    private readonly strengths: Float32Array;
    private readonly widths: Float32Array;
    private readonly lightning: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly lightningGeometry: THREE.BufferGeometry;
    private readonly lightningMaterial: THREE.ShaderMaterial;
    private readonly sparks: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly streaks: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly streakCount: number;
    private activeStreaks: number;
    private readonly anchor = new THREE.Vector3();
    private finished = false;
    private randomState = 1;
    private lastPulse = -1;
    private lastWallTime = 0;
    private slowTime = 0;

    constructor(card: THREE.Mesh, mobile = false) {
        this.card = card;
        this.mobile = mobile;
        this.maxArcs = mobile ? 3 : 6;
        this.activeArcs = this.maxArcs;
        this.refreshHz = mobile ? 12 : 20;
        this.root.name = 'ElectricEffect';
        this.transformation = new CardTransformation(card, 'electric', mobile);
        this.root.add(this.transformation.root);

        const pathCount = this.maxArcs * 3;
        const vertexCount = pathCount * VERTICES_PER_PATH;
        this.pathPoints = new Float32Array(pathCount * POINTS_PER_PATH * 3);
        this.positions = new Float32Array(vertexCount * 3);
        this.tangents = new Float32Array(vertexCount * 3);
        this.strengths = new Float32Array(vertexCount);
        this.widths = new Float32Array(vertexCount);
        const sides = new Float32Array(vertexCount);
        const times = new Float32Array(vertexCount);
        const indices: number[] = [];
        for (let path = 0; path < pathCount; path++) {
            for (let point = 0; point < POINTS_PER_PATH; point++) {
                const vertex = path * VERTICES_PER_PATH + point * 2;
                sides[vertex] = -1;
                sides[vertex + 1] = 1;
                times[vertex] = times[vertex + 1] = point / SEGMENTS;
                if (point < SEGMENTS) {
                    indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
                }
            }
        }
        this.lightningGeometry = new THREE.BufferGeometry();
        this.lightningGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.lightningGeometry.setAttribute('aTangent', new THREE.BufferAttribute(this.tangents, 3).setUsage(THREE.DynamicDrawUsage));
        this.lightningGeometry.setAttribute('aStrength', new THREE.BufferAttribute(this.strengths, 1).setUsage(THREE.DynamicDrawUsage));
        this.lightningGeometry.setAttribute('aWidth', new THREE.BufferAttribute(this.widths, 1).setUsage(THREE.DynamicDrawUsage));
        this.lightningGeometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
        this.lightningGeometry.setAttribute('aT', new THREE.BufferAttribute(times, 1));
        this.lightningGeometry.setIndex(indices);
        this.lightningGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 4);
        this.lightningMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uOpacity: { value: 0 },
                uGold: { value: new THREE.Color(0xffb800) },
                uYellow: { value: new THREE.Color(0xffd400) },
                uWhite: { value: new THREE.Color(0xfffdeb) },
            },
            vertexShader: lightningVertex,
            fragmentShader: lightningFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            forceSinglePass: true,
        });
        this.lightning = new THREE.Mesh(this.lightningGeometry, this.lightningMaterial);
        this.root.add(this.lightning);

        const sparkCount = mobile ? 40 : 80;
        const sparkGeometry = new THREE.BufferGeometry();
        const sparkData = new Float32Array(sparkCount * 4);
        for (let i = 0; i < sparkCount; i++) {
            const offset = i * 4;
            sparkData[offset] = (i * 0.61803398875) % 1;
            sparkData[offset + 1] = 0.7 + (i * 0.38196601125) % 0.8;
            sparkData[offset + 2] = (i * 2.3999632297) % TAU;
            sparkData[offset + 3] = (i * 0.754877666) % 1;
        }
        sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3));
        sparkGeometry.setAttribute('aSpark', new THREE.BufferAttribute(sparkData, 4));
        sparkGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 2.4);
        this.sparks = new THREE.Points(sparkGeometry, new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uOpacity: { value: 0 }, uViewportHeight: { value: 800 },
                uOrange: { value: new THREE.Color(0xff9f1a) },
                uWhite: { value: new THREE.Color(0xfffdeb) },
            },
            vertexShader: sparkVertex,
            fragmentShader: sparkFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
        }));
        this.root.add(this.sparks);

        this.streakCount = mobile ? 6 : 12;
        this.activeStreaks = this.streakCount;
        const streakGeometry = new THREE.BufferGeometry();
        const corners = new Float32Array(this.streakCount * 4 * 2);
        const streakData = new Float32Array(this.streakCount * 4 * 4);
        const streakIndices: number[] = [];
        for (let i = 0; i < this.streakCount; i++) {
            for (let corner = 0; corner < 4; corner++) {
                const vertex = i * 4 + corner;
                corners[vertex * 2] = corner >= 2 ? 1 : 0;
                corners[vertex * 2 + 1] = corner % 2 === 0 ? -1 : 1;
                streakData[vertex * 4] = (i * 0.61803398875) % 1;
                streakData[vertex * 4 + 1] = 0.85 + (i * 0.38196601125) % 0.75;
                streakData[vertex * 4 + 2] = (i * 2.3999632297) % TAU;
                streakData[vertex * 4 + 3] = (i * 0.754877666) % 1;
            }
            const base = i * 4;
            streakIndices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
        streakGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.streakCount * 4 * 3), 3));
        streakGeometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
        streakGeometry.setAttribute('aStreak', new THREE.BufferAttribute(streakData, 4));
        streakGeometry.setIndex(streakIndices);
        streakGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.65, 0), 4);
        this.streaks = new THREE.Mesh(streakGeometry, new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uOpacity: { value: 0 },
                uOrange: { value: new THREE.Color(0xff9f1a) },
                uWhite: { value: new THREE.Color(0xfffdeb) },
            },
            vertexShader: streakVertex,
            fragmentShader: streakFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            forceSinglePass: true,
        }));
        this.root.add(this.streaks);
        this.root.visible = false;
    }

    setActive(active: boolean): void {
        this.root.visible = active;
        this.transformation.setActive(active);
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        timeline.to(this.state, { sparks: 0.55, duration: 0.4, ease: 'power3.out' }, 0.4);
        timeline.to(this.state, { flash: 1, duration: 0.08, ease: 'power2.out' }, 0.45);
        timeline.to(this.state, { flash: 0, duration: 0.18 }, 0.53);
        timeline.to(this.state, { storm: 1, sparks: 1, duration: 0.65, ease: 'power2.out' }, 0.8);
        timeline.to(this.state, { flash: 1, duration: 0.08, ease: 'power2.out' }, 2.48);
        timeline.to(this.state, { flash: 0, duration: 0.18 }, 2.56);
    }

    private random(): number {
        this.randomState ^= this.randomState << 13;
        this.randomState ^= this.randomState >>> 17;
        this.randomState ^= this.randomState << 5;
        return (this.randomState >>> 0) / 4294967296;
    }

    private writePath(index: number, sx: number, sy: number, sz: number, ex: number, ey: number, ez: number,
        jitter: number, energy: number, bendX = 0, bendZ = 0): void {
        const base = index * POINTS_PER_PATH * 3;
        const coarseX = (this.random() - 0.5) * jitter;
        const coarseY = (this.random() - 0.5) * jitter * 0.55;
        const coarseZ = (this.random() - 0.5) * jitter * 0.75;
        for (let point = 0; point < POINTS_PER_PATH; point++) {
            const t = point / SEGMENTS;
            const envelope = Math.sin(Math.PI * t);
            const offset = base + point * 3;
            this.pathPoints[offset] = sx + (ex - sx) * t
                + (coarseX + bendX + (this.random() - 0.5) * jitter * 0.62) * envelope;
            this.pathPoints[offset + 1] = sy + (ey - sy) * t
                + (coarseY + (this.random() - 0.5) * jitter * 0.36) * envelope;
            this.pathPoints[offset + 2] = sz + (ez - sz) * t
                + (coarseZ + bendZ + (this.random() - 0.5) * jitter * 0.50) * envelope;
        }
        for (let point = 0; point < POINTS_PER_PATH; point++) {
            const center = base + point * 3;
            const previous = base + Math.max(0, point - 1) * 3;
            const next = base + Math.min(SEGMENTS, point + 1) * 3;
            const tx = this.pathPoints[next] - this.pathPoints[previous];
            const ty = this.pathPoints[next + 1] - this.pathPoints[previous + 1];
            const tz = this.pathPoints[next + 2] - this.pathPoints[previous + 2];
            const length = Math.hypot(tx, ty, tz) || 1;
            const width = (index % 3 === 0 ? 0.065 : 0.034) * (0.65 + this.random() * 0.65);
            for (let side = 0; side < 2; side++) {
                const vertex = index * VERTICES_PER_PATH + point * 2 + side;
                const offset = vertex * 3;
                this.positions[offset] = this.pathPoints[center];
                this.positions[offset + 1] = this.pathPoints[center + 1];
                this.positions[offset + 2] = this.pathPoints[center + 2];
                this.tangents[offset] = tx / length;
                this.tangents[offset + 1] = ty / length;
                this.tangents[offset + 2] = tz / length;
                this.widths[vertex] = width;
                this.strengths[vertex] = energy;
            }
        }
    }

    private refreshLightning(time: number): void {
        const pulse = Math.floor(time * this.refreshHz);
        if (pulse === this.lastPulse) return;
        this.lastPulse = pulse;
        this.randomState = ((pulse + 1) * 0x9e3779b9) | 1;
        this.strengths.fill(0);
        const arcCount = this.transformation.state.energy > 0.01 ? this.activeArcs : 0;
        if (arcCount === 0) {
            this.lightningGeometry.getAttribute('aStrength').needsUpdate = true;
            return;
        }
        this.card.updateWorldMatrix(true, false);
        this.root.updateWorldMatrix(true, false);
        const cardArcCount = this.transformation.state.morph > 0.1 ? Math.min(arcCount - 1, this.mobile ? 2 : 4) : 0;
        for (let arc = 0; arc < arcCount; arc++) {
            let ex: number;
            let ey: number;
            let ez: number;
            const aimsAtCard = arc < cardArcCount;
            let edgeIndex = -1;
            if (aimsAtCard) {
                edgeIndex = arc;
                const [edgeX, edgeY] = CARD_EDGE_ANCHORS[edgeIndex];
                this.anchor.set(edgeX, edgeY, 0.045);
                this.card.localToWorld(this.anchor);
                this.root.worldToLocal(this.anchor);
                ex = this.anchor.x;
                ey = this.anchor.y;
                ez = this.anchor.z;
            } else {
                const side = arc % 2 === 0 ? -1 : 1;
                const spread = 0.60 + (arc / arcCount) * 0.90 + this.random() * 0.45;
                ex = side * spread;
                ey = 0.28 + this.random() * 1.08;
                ez = 0.48 + this.random() * 0.34;
            }
            const mainIndex = arc * 3;
            const energy = (0.60 + this.random() * 0.4) * (0.55 + this.state.storm * 0.45);
            const sourceX = (this.random() - 0.5) * 0.28;
            const sourceZ = 0.23 + this.random() * 0.20;
            const outsideSign = edgeIndex === 0 || edgeIndex === 2 ? -1 : 1;
            this.writePath(mainIndex, sourceX, -0.07, sourceZ, ex, ey, ez,
                aimsAtCard ? 0.16 + this.state.storm * 0.12 : 0.26 + this.state.storm * 0.24,
                energy,
                aimsAtCard ? outsideSign * 0.72 : 0,
                aimsAtCard ? 0.10 : 0);
            for (let branch = 0; branch < this.activeBranches; branch++) {
                const point = branch === 0 ? 6 : 12;
                const offset = (mainIndex * POINTS_PER_PATH + point) * 3;
                const sx = this.pathPoints[offset];
                const sy = this.pathPoints[offset + 1];
                const sz = this.pathPoints[offset + 2];
                const direction = aimsAtCard ? outsideSign : this.random() < 0.5 ? -1 : 1;
                this.writePath(mainIndex + branch + 1, sx, sy, sz,
                    sx + direction * (0.18 + this.random() * (aimsAtCard ? 0.25 : 0.38)),
                    sy + (aimsAtCard ? -0.08 : 0.12) + this.random() * 0.28,
                    sz + (this.random() - 0.5) * 0.50,
                    aimsAtCard ? 0.10 : 0.18, energy * this.state.storm * (aimsAtCard ? 0.52 : 0.72));
            }
        }
        this.lightningGeometry.getAttribute('position').needsUpdate = true;
        this.lightningGeometry.getAttribute('aTangent').needsUpdate = true;
        this.lightningGeometry.getAttribute('aWidth').needsUpdate = true;
        this.lightningGeometry.getAttribute('aStrength').needsUpdate = true;
    }

    update(time: number, viewportHeight: number): void {
        const shared = this.transformation.state;
        if (!this.finished && shared.cardImage < 0.999) {
            const wallTime = performance.now();
            if (this.lastWallTime > 0) {
                const frameTime = wallTime - this.lastWallTime;
                this.slowTime = frameTime > 27 && frameTime < 100 ? this.slowTime + frameTime : Math.max(0, this.slowTime - frameTime);
                if (this.slowTime > 1000) {
                    if (this.activeBranches > 0) this.activeBranches--;
                    else if (this.activeStreaks > 3) {
                        this.activeStreaks = Math.max(3, this.activeStreaks - 3);
                        this.streaks.geometry.setDrawRange(0, this.activeStreaks * 6);
                    } else if (this.refreshHz > (this.mobile ? 10 : 12)) this.refreshHz -= 4;
                    else this.activeArcs = Math.max(2, this.activeArcs - 1);
                    this.slowTime = 0;
                }
            }
            this.lastWallTime = wallTime;
            this.refreshLightning(time);
        }
        const revealOpacity = this.finished ? 0 : shared.fade * (1 - shared.cardImage);
        this.lightningMaterial.uniforms.uTime.value = time;
        this.lightningMaterial.uniforms.uOpacity.value = shared.energy * revealOpacity
            * (1 - shared.morph * 0.22) * (1 + this.state.flash * 0.45);
        this.lightning.visible = revealOpacity > 0.001;
        this.sparks.material.uniforms.uTime.value = time;
        this.sparks.material.uniforms.uOpacity.value = this.state.sparks * revealOpacity;
        this.sparks.material.uniforms.uViewportHeight.value = viewportHeight;
        this.sparks.visible = this.state.sparks * revealOpacity > 0.001;
        this.streaks.material.uniforms.uTime.value = time;
        this.streaks.material.uniforms.uOpacity.value = this.state.sparks * revealOpacity
            * (0.55 + this.state.storm * 0.45) * (1 - shared.morph * 0.35);
        this.streaks.visible = this.state.sparks * revealOpacity > 0.001;
        this.transformation.update(time, shared.morph * revealOpacity * 0.28);
    }

    reset(): void {
        this.finished = false;
        this.transformation.reset();
        Object.assign(this.state, { storm: 0, sparks: 0, flash: 0 });
        this.activeArcs = this.maxArcs;
        this.activeBranches = 2;
        this.activeStreaks = this.streakCount;
        this.streaks.geometry.setDrawRange(0, this.streakCount * 6);
        this.lightning.visible = true;
        this.refreshHz = this.mobile ? 12 : 20;
        this.lastPulse = -1;
        this.lastWallTime = 0;
        this.slowTime = 0;
        this.update(0, 800);
    }

    finish(): void {
        this.finished = true;
        this.transformation.finish();
        this.lightning.visible = false;
        this.sparks.visible = false;
        this.streaks.visible = false;
    }

    dispose(): void {
        this.root.removeFromParent();
        this.transformation.dispose();
        this.lightningGeometry.dispose();
        this.lightningMaterial.dispose();
        this.sparks.geometry.dispose();
        this.sparks.material.dispose();
        this.streaks.geometry.dispose();
        this.streaks.material.dispose();
    }
}
