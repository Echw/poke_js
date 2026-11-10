import * as THREE from 'three';
import { acquireEffectTexture, type EffectTextureLease } from './effectTextures';
import { CardTransformation, CARD_REVEAL_TIMING as T } from './cardTransformation';
import { makeRibbons } from './ribbonGeometry';
import { earthPosition, earthRotation } from './earthMotion';
import type { PokemonRevealEffect } from './types';

const SOURCE = new THREE.Vector3(0, -0.065, 0.38);
const smooth = THREE.MathUtils.smoothstep;
const TAU = Math.PI * 2;

// Fragment positions and the camera are both in the actual rotating card's space.
// Shared by the opaque metal and additive atmosphere, including rear fragments.
const cardMask = /* glsl */ `
    vec3 steelRay = vSteelCard - uSteelCameraCard;
    float steelPlane = -uSteelCameraCard.z / (abs(steelRay.z) < 0.0001 ? -0.0001 : steelRay.z);
    vec2 steelProjected = uSteelCameraCard.xy + steelRay.xy * steelPlane;
    vec2 steelQ = abs(steelProjected) - vec2(0.37, 0.52) * uSteelClearance;
    if (uSteelClearance > 0.01 && max(steelQ.x, steelQ.y) < 0.0) discard;
`;

const atmosphereVertex = /* glsl */ `
    uniform mat4 uSteelWorldToCard;
    varying vec3 vSteelCard;
    varying vec2 vUv;
    void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vSteelCard = (uSteelWorldToCard * world).xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

const atmosphereFragment = /* glsl */ `
    uniform vec3 uSteelCameraCard;
    uniform float uSteelClearance;
    uniform float uOpacity;
    uniform float uBeam;
    uniform float uTime;
    varying vec3 vSteelCard;
    varying vec2 vUv;
    void main() {
        ${cardMask}
        vec2 p = (vUv - 0.5) * 2.0;
        float radius = length(p);
        float halo = exp(-dot(p,p)*3.4) * (1.0-smoothstep(0.65,1.0,radius));
        float angle = atan(p.y,p.x);
        float rays = pow(max(0.0,sin(angle*9.0+sin(angle*3.0-uTime)*0.65)),12.0);
        float burst = exp(-dot(p,p)*14.0)*0.85 + rays*exp(-radius*5.5)*0.60;
        float folds = 0.65+0.35*sin(angle*5.0+radius*8.0-uTime*0.8);
        float haze = halo*(0.60+folds*0.40);
        float alpha = (uBeam < 0.5 ? halo : uBeam < 1.5 ? burst : haze)*uOpacity;
        if (alpha < 0.001) discard;
        gl_FragColor = vec4(vec3(0.66,0.79,1.0),alpha);
        #include <colorspace_fragment>
    }
`;

const energyFragment = /* glsl */ `
    uniform vec3 uSteelCameraCard;
    uniform float uSteelClearance;
    uniform float uOpacity;
    uniform float uTime;
    varying vec3 vSteelCard;
    varying vec2 vUv;
    void main() {
        ${cardMask}
        float side = abs(vUv.y*2.0-1.0);
        float hot = exp(-side*side*65.0);
        float sheath = exp(-side*side*10.0)*0.30;
        float end = 1.0-smoothstep(0.72,1.0,vUv.x);
        float flow = 0.87+0.13*sin(vUv.x*19.0-uTime*4.2);
        float alpha = (hot+sheath)*end*uOpacity*flow;
        if (alpha < 0.001) discard;
        vec3 color = mix(vec3(0.50,0.62,1.0),vec3(1.5,1.5,1.6),hot);
        gl_FragColor = vec4(color,alpha);
        #include <colorspace_fragment>
    }
`;

/** UVs run along the open path; micro-grooves follow the strip's long direction. */
function addStripUV(geometry: THREE.BufferGeometry): void {
    const uv = new Float32Array(geometry.getAttribute('position').count * 2);
    for (let i = 0; i < uv.length / 2; i++) {
        uv[i * 2] = geometry.getAttribute('aT').getX(i);
        uv[i * 2 + 1] = geometry.getAttribute('aSide').getX(i) * 0.5 + 0.5;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Open cut sheet: curled machining swarf or a long twisted shaving, never a bead. */
function metalShaving(curled: boolean): THREE.BufferGeometry {
    const segments = 14;
    const geometry = new THREE.PlaneGeometry(1, 1, 1, segments);
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
        const t = geometry.getAttribute('uv').getY(i);
        const side = geometry.getAttribute('uv').getX(i) * 2 - 1;
        const angle = -1.1 + t * 4.5;
        const width = side * (0.22 + Math.sin(t * Math.PI) * 0.10);
        if (curled) positions.setXYZ(i, Math.cos(angle) * (0.74 + width * 0.30),
            Math.sin(angle) * (0.95 + width * 0.30), (t - 0.5) * 0.72 + width);
        else positions.setXYZ(i, Math.sin(t * 4.8) * 0.32 + Math.cos(angle) * width,
            (t - 0.5) * 2.6, Math.cos(t * 4.8) * 0.22 + Math.sin(angle) * width);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
}

function cutMetalFlake(folded = false): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape(folded ? [
        new THREE.Vector2(-0.65, -0.40), new THREE.Vector2(0, -0.90),
        new THREE.Vector2(0.75, -0.20), new THREE.Vector2(0.55, 0.65),
        new THREE.Vector2(0, 0.90), new THREE.Vector2(-0.60, 0.30),
    ] : [
        new THREE.Vector2(-0.72, -0.52), new THREE.Vector2(0.45, -0.68),
        new THREE.Vector2(0.78, 0.12), new THREE.Vector2(0.23, 0.70), new THREE.Vector2(-0.55, 0.40),
    ]);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.065, bevelEnabled: false, steps: 1 });
    geometry.translate(0, 0, -0.0325);
    if (folded) {
        const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) positions.setZ(i, positions.getZ(i) + 0.35 - Math.abs(positions.getX(i)) * 0.5);
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
    }
    return geometry;
}

/** A small, owned studio reflection map: dark graphite between three cool strip lights.
 * The scene's night HDR remains unchanged; all Steel surfaces share this environment.
 */
function studioReflections(): THREE.DataTexture {
    const width = 256, height = 128;
    const pixels = new Float32Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const u = x / width, v = y / height;
        const strip = (center: number, breadth: number, strength: number) => {
            const distance = Math.min(Math.abs(u - center), 1 - Math.abs(u - center));
            return Math.exp(-Math.pow(distance / breadth, 6)) * strength
                * smooth(v, 0.10, 0.26) * (1 - smooth(v, 0.74, 0.92));
        };
        const light = 0.045 + strip(0.14, 0.045, 3.8) + strip(0.56, 0.085, 2.2) + strip(0.85, 0.018, 5);
        const i = (y * width + x) * 4;
        pixels.set([light * 0.90, light * 0.95, light, 1], i);
    }
    const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    return texture;
}

function brushedRoughness(): THREE.DataTexture {
    const data = new Uint8Array(128 * 4);
    for (let i = 0; i < 128; i++) {
        const value = 145 + Math.round(Math.sin(i * 41.7) * 4 + Math.sin(i * 7.3) * 3);
        data.set([value, value, value, 255], i * 4);
    }
    const texture = new THREE.DataTexture(data, 1, 128);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 5);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

interface Droplet {
    mesh: THREE.InstancedMesh;
    index: number;
    birth: number;
    life: number;
    base: THREE.Vector3;
    velocity: THREE.Vector3;
    axis: THREE.Vector3;
    rotation: THREE.Quaternion;
    scale: THREE.Vector3;
    spin: number;
    settled: boolean;
    hero?: boolean;
}

/** Two broad open sweeps, source energy and rigid flakes on the existing host clock.
 * Custom geometry is necessary: the standalone app has no Sataku 3D.js runtime.
 * Strip topology comes from Grass/Dragon; Water's source-born ballistic motion and
 * Fighting's instanced rigid transforms are reused without their liquid/stone look.
 */
export class SteelEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xddeaff);
    readonly fillLightPosition = SOURCE.clone();
    readonly transformation: CardTransformation;
    readonly ready: Promise<void>;
    private readonly environment = studioReflections();
    private readonly brush = brushedRoughness();
    private readonly metal = new THREE.MeshStandardMaterial({
        color: 0xc6cfde, metalness: 1, roughness: 0.32,
        envMap: this.environment, envMapIntensity: 1.15, roughnessMap: this.brush,
        side: THREE.DoubleSide,
    });
    private readonly ribbons: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    private readonly filament: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly energizedJets: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly jets: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    private readonly debris: THREE.InstancedMesh[] = [];
    private readonly droplets: Droplet[] = [];
    private readonly glints: THREE.Sprite[] = [];
    private readonly glintTexture: THREE.CanvasTexture;
    private readonly dummy = new THREE.Object3D();
    private readonly spin = new THREE.Quaternion();
    private readonly center = new THREE.Vector3();
    private readonly tangent = new THREE.Vector3();
    private readonly across = new THREE.Vector3();
    private readonly radial = new THREE.Vector3();
    private readonly binormal = new THREE.Vector3();
    private readonly ahead = new THREE.Vector3();
    private readonly worldToCard = { value: new THREE.Matrix4() };
    private readonly cameraInCard = { value: new THREE.Vector3() };
    private readonly cardClearance = { value: 0 };
    private readonly atmosphere: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
    private readonly rimLight = new THREE.DirectionalLight(0xc7dcff, 0);
    private readonly accentLight = new THREE.DirectionalLight(0xf5f8ff, 0);
    private brushLease?: EffectTextureLease;
    private finished = false;
    private disposed = false;
    private time = 0;
    private readonly tail = { progress: 0 };
    private readonly lateralScale: number;

    constructor(card: THREE.Mesh, mobile = false) {
        this.lateralScale = mobile ? 0.86 : 1;
        this.root.name = 'SteelEffect';
        // PBR reflections use real deformed normals. Only card clearance extends the
        // installed Standard shader; positions below are world/card-local respectively.
        this.metal.onBeforeCompile = shader => {
            shader.uniforms.uSteelWorldToCard = this.worldToCard;
            shader.uniforms.uSteelClearance = this.cardClearance;
            shader.vertexShader = 'uniform mat4 uSteelWorldToCard; varying vec3 vSteelCard;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
                #include <project_vertex>
                vec4 steelPosition = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                steelPosition = instanceMatrix * steelPosition;
                #endif
                vSteelCard = (uSteelWorldToCard * modelMatrix * steelPosition).xyz;
            `);
            shader.uniforms.uSteelCameraCard = this.cameraInCard;
            shader.fragmentShader = 'uniform float uSteelClearance; uniform vec3 uSteelCameraCard; varying vec3 vSteelCard;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
                #include <clipping_planes_fragment>
                ${cardMask}
            `);
        };
        this.metal.customProgramCacheKey = () => 'steel-card-clearance-v2';
        this.transformation = new CardTransformation(card, 'steel', mobile);
        this.root.add(this.transformation.root);
        this.ribbons = new THREE.Mesh(makeRibbons(2, 1, mobile ? 96 : 144, 4), this.metal);
        this.ribbons.name = 'SteelOpenRibbons';
        addStripUV(this.ribbons.geometry);
        const energyMaterial = new THREE.ShaderMaterial({
            uniforms: { uSteelWorldToCard: this.worldToCard, uSteelCameraCard: this.cameraInCard,
                uSteelClearance: this.cardClearance, uOpacity: { value: 0 }, uTime: { value: 0 } },
            vertexShader: atmosphereVertex, fragmentShader: energyFragment,
            transparent: true, blending: THREE.AdditiveBlending, depthTest: true,
            depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
        });
        this.filament = new THREE.Mesh(makeRibbons(5, 1, 72, 6), energyMaterial);
        addStripUV(this.filament.geometry);
        this.filament.name = 'SteelFilament';
        this.jets = new THREE.Mesh(makeRibbons(mobile ? 6 : 10, 1, 24, 2), this.metal);
        this.jets.name = 'SteelBasinSplashes';
        addStripUV(this.jets.geometry);
        this.energizedJets = new THREE.Mesh(this.jets.geometry, energyMaterial.clone());
        this.energizedJets.material.uniforms.uSteelWorldToCard = this.worldToCard;
        this.energizedJets.material.uniforms.uSteelCameraCard = this.cameraInCard;
        this.energizedJets.material.uniforms.uSteelClearance = this.cardClearance;
        this.energizedJets.name = 'SteelSourceBranches';
        this.filament.renderOrder = this.energizedJets.renderOrder = 3.2;
        this.root.add(this.ribbons, this.filament, this.jets, this.energizedJets);
        const syncCardSpace: THREE.Object3D['onBeforeRender'] = (_renderer, _scene, camera) => {
            card.updateWorldMatrix(true, false);
            this.worldToCard.value.copy(card.matrixWorld).invert();
            this.cameraInCard.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.worldToCard.value);
        };
        for (const mesh of [this.ribbons, this.jets, this.filament, this.energizedJets]) {
            mesh.frustumCulled = false;
            mesh.onBeforeRender = syncCardSpace;
        }

        this.rimLight.name = 'SteelRimLight';
        this.accentLight.name = 'SteelAccentLight';
        this.rimLight.position.set(-1.3, 1.0, -0.4);
        this.accentLight.position.set(1.25, 0.65, 1.35);
        const lightTarget = new THREE.Object3D();
        lightTarget.position.set(0, 0.30, SOURCE.z);
        this.rimLight.target = this.accentLight.target = lightTarget;
        this.root.add(this.rimLight, this.accentLight, lightTarget);
        for (let i = 0; i < 3; i++) {
            const geometry = new THREE.PlaneGeometry(i === 1 ? 0.98 : 2.4, i === 1 ? 0.74 : 1.65);
            geometry.scale(this.lateralScale, 1, 1);
            geometry.translate(0, i === 1 ? 0.025 : 0.37, i === 1 ? 0.66 : i === 0 ? 0.52 : 0.24);
            const material = new THREE.ShaderMaterial({
                uniforms: { uSteelWorldToCard: this.worldToCard, uSteelCameraCard: this.cameraInCard,
                    uSteelClearance: this.cardClearance, uOpacity: { value: 0 },
                    uBeam: { value: i }, uTime: { value: 0 } },
                vertexShader: atmosphereVertex, fragmentShader: atmosphereFragment,
                transparent: true, blending: THREE.AdditiveBlending,
                depthTest: true, depthWrite: false, side: THREE.DoubleSide,
                forceSinglePass: true, toneMapped: false,
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = ['SteelHalo','SteelBasinRadiance','SteelOuterHaze'][i]!;
            mesh.frustumCulled = false;
            mesh.renderOrder = 2.1;
            mesh.onBeforeRender = syncCardSpace;
            this.atmosphere.push(mesh); this.root.add(mesh);
        }

        // Cut sheet silhouettes: curled swarf, twisted shavings and thin angular flakes.
        const shapes = [metalShaving(true), metalShaving(false), cutMetalFlake()];
        const count = mobile ? 24 : 38;
        for (let variant = 0; variant < shapes.length; variant++) {
            const mesh = new THREE.InstancedMesh(shapes[variant], this.metal, count);
            mesh.name = ['SteelCurledChips', 'SteelTwistedShavings', 'SteelFlakes'][variant]!;
            mesh.frustumCulled = false;
            mesh.onBeforeRender = syncCardSpace;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.debris.push(mesh); this.root.add(mesh);
            for (let i = 0; i < count; i++) {
                const id = i * 3 + variant;
                const a = (id * 0.618033989 + 0.17) % 1;
                const b = (id * 0.754877666 + 0.31) % 1;
                const side = id % 2 ? 1 : -1;
                const size = 0.015 + b * b * 0.026;
                // A few early particles, dense overlapping bursts at the orbit peak, then a sparse tail.
                const birth = i < 2 ? 0.16 + i * 0.16 + variant * 0.05
                    : i > count - 5 ? 1.65 + a * 0.64 : 0.40 + ((id * 0.41421356 + 0.2) % 1) * 0.98;
                this.droplets.push({ mesh, index: i, birth, life: 0.70 + b * 0.42,
                    base: new THREE.Vector3(side * (0.025 + b * 0.12), -0.07, 0.26 + a * 0.22),
                    velocity: new THREE.Vector3(side * (0.60 + b * 1.18) * this.lateralScale, 1.05 + a * 1.80, (b - 0.55) * 0.62),
                    axis: new THREE.Vector3(a + 0.1, b - 0.4, 0.7).normalize(),
                    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(a * TAU, b * TAU, id)),
                    scale: new THREE.Vector3(size, size * (variant === 1 ? 1.25 : 1), size),
                    spin: 2 + a * 7, settled: variant === 2 && i < 3,
                });
                const drop = this.droplets[this.droplets.length - 1]!;
                if (drop.settled) {
                    drop.base.x = side * 0.16;
                    drop.velocity.set(side * (0.65 + b * 0.10), 1.0 + a * 0.30, (b - 0.5) * 0.16);
                }
            }
        }
        // A few larger cut pieces establish scale above and outside the fine swarf.
        // Folded faces alternate bright reflections and dark graphite planes.
        const heroCount = mobile ? 6 : 8;
        const heroes = new THREE.InstancedMesh(cutMetalFlake(true), this.metal, heroCount);
        heroes.name = 'SteelHeroShards'; heroes.frustumCulled = false;
        heroes.onBeforeRender = syncCardSpace;
        heroes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.debris.push(heroes); this.root.add(heroes);
        for (let i = 0; i < heroCount; i++) {
            const a = (i * 0.618034 + 0.23) % 1, b = (i * 0.754878 + 0.47) % 1;
            const side = i % 2 ? 1 : -1;
            const size = (0.065 + b * 0.038) * this.lateralScale;
            this.droplets.push({ mesh: heroes, index: i, birth: 0.18 + b * 0.86, life: 1.25 + b * 0.25,
                base: new THREE.Vector3(side * 0.09, SOURCE.y, SOURCE.z),
                velocity: new THREE.Vector3(side * (0.72 + a * 0.85) * this.lateralScale, 2.0 + a * 1.1, (b - 0.35) * 0.30),
                axis: new THREE.Vector3(0.3 + a, 0.5, b - 0.4).normalize(),
                rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(a * 3, b * 4, i * 1.7)),
                scale: new THREE.Vector3(size, size * (1.25 + a * 0.70), size), spin: 1.3 + b * 2.1,
                settled: false, hero: true });
        }
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
        gradient.addColorStop(0, '#fff'); gradient.addColorStop(0.12, '#edf4ff');
        gradient.addColorStop(0.36, 'rgba(196,218,255,0.18)'); gradient.addColorStop(1, 'rgba(196,218,255,0)');
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
        ctx.strokeStyle = '#eff7ff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(6, 32); ctx.lineTo(58, 32); ctx.moveTo(32, 6); ctx.lineTo(32, 58); ctx.stroke();
        this.glintTexture = new THREE.CanvasTexture(canvas);
        for (let i = 0; i < 10; i++) {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glintTexture,
                transparent: true, blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false, toneMapped: false }));
            sprite.name = `SteelEdgeGlint${i}`;
            this.glints.push(sprite); this.root.add(sprite);
        }
        this.root.visible = false;
        this.ready = this.loadBrush(mobile);
    }

    /** Settle before host playback; late arrivals after timeout/disposal are discarded. */
    private loadBrush(mobile: boolean): Promise<void> {
        const lease = this.brushLease = acquireEffectTexture(mobile ? 'steelMobile' : 'steelDesktop');
        return new Promise(resolve => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true; window.clearTimeout(timeout); resolve();
            };
            const timeout = window.setTimeout(() => { lease.release(); finish(); }, 4000);
            lease.ready.then(texture => {
                if (settled || this.disposed) { lease.release(); finish(); return; }
                this.metal.roughnessMap = this.metal.bumpMap = texture;
                this.metal.roughness = 0.5;
                this.metal.bumpScale = 0.0011;
                this.metal.needsUpdate = true;
                finish();
            }, () => { lease.release(); finish(); });
        });
    }

    get fillLightIntensity(): number {
        return this.finished ? 0.10 : smooth(this.time, 0, 0.5) * (1 - smooth(this.time, T.morph, T.fade)) * 2.8;
    }

    setActive(active: boolean): void {
        if (this.disposed) return;
        this.root.visible = active;
        this.transformation.setActive(active);
        if (!active) this.rimLight.intensity = this.accentLight.intensity = 0;
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        timeline.to(this.tail, { progress: 1, duration: 0.25, ease: 'none' }, T.complete);
    }

    /** A broad near-horizontal sweep and a thinner rising return share one source. */
    private ribbonPoint(out: THREE.Vector3, t: number, band: number, time: number): void {
        const angle = t * (band === 0 ? 6.0 : 4.8) + (band === 0 ? -2.4 : 0.85) + time * 0.24;
        const radius = smooth(t, 0, band === 0 ? 0.23 : 0.32) * (band === 0 ? 1.03 : 0.96);
        const height = band === 0 ? t * 0.15 + smooth(t, 0, 0.70) * 0.58 : t * 1.04;
        out.set(Math.cos(angle) * radius * this.lateralScale,
            SOURCE.y + height + Math.sin(angle) * 0.065 * smooth(t, 0, 0.15),
            SOURCE.z + Math.sin(angle) * radius * 0.43);
        // Retreat behind the card before its image appears; no strip crosses the illustration.
        out.z = THREE.MathUtils.lerp(out.z, Math.min(out.z, 0.10), smooth(time, T.rotation, T.morph + 0.28));
    }

    private updateRibbons(time: number): void {
        const geometry = this.ribbons.geometry;
        const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
        const growth = 0.05 + smooth(time, 0.06, 1.08) * 0.95;
        const retreat = smooth(time, T.image - 0.1, 3.12);
        for (let i = 0; i < positions.count; i++) {
            const u = geometry.getAttribute('aT').getX(i);
            const band = geometry.getAttribute('aRibbon').getX(i);
            const t = u * growth * (1 - retreat * 0.93);
            this.ribbonPoint(this.center, t, band, time);
            this.ribbonPoint(this.ahead, t + 0.002, band, time);
            this.tangent.subVectors(this.ahead, this.center).normalize();
            this.radial.set(this.center.x, 0.25, this.center.z - SOURCE.z);
            this.across.crossVectors(this.tangent, this.radial).normalize();
            this.binormal.crossVectors(this.tangent, this.across).normalize();
            const twist = 0.34 * Math.sin(t * 5.5 - time * 1.7 + band) + 0.35;
            this.across.multiplyScalar(Math.cos(twist)).addScaledVector(this.binormal, Math.sin(twist));
            const width = (band === 0 ? 0.040 : 0.022) * Math.pow(Math.max(0, Math.sin(u * Math.PI)), 0.65)
                * smooth(time, 0.02, 0.42) * (1 - retreat);
            this.center.addScaledVector(this.across, geometry.getAttribute('aSide').getX(i) * width);
            positions.setXYZ(i, this.center.x, this.center.y, this.center.z);
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    private updateSource(time: number): void {
        const growth = smooth(time, 0.10, 0.90);
        const geometry = this.filament.geometry, positions = geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i++) {
            const t = geometry.getAttribute('aT').getX(i);
            const side = geometry.getAttribute('aSide').getX(i);
            const band = geometry.getAttribute('aRibbon').getX(i);
            let x: number, height: number;
            if (band < 2) {
                x = Math.sin(t * 5.4 - time * 0.8) * Math.sin(t * Math.PI) * 0.105
                    + band * Math.sin(t * Math.PI) * 0.065;
                height = t * (band === 0 ? 1.25 : 0.94);
            } else {
                const ray = band - 2, sign = ray % 2 ? 1 : -1;
                x = sign * t * (0.26 + ray * 0.06) + Math.sin(t * 7.0 + time) * Math.sin(t * Math.PI) * 0.035;
                height = t * (0.36 + ray * 0.13);
            }
            const width = (band < 2 ? 0.070 : 0.038) * Math.pow(1 - t, 0.72) * growth;
            positions.setXYZ(i, x * growth + side * width, SOURCE.y + height * growth,
                SOURCE.z + smooth(t, 0, 0.30) * 0.24 + Math.sin(t * 4.0) * 0.025);
        }
        positions.needsUpdate = true;
        const jets = this.jets.geometry, jetPositions = jets.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < jetPositions.count; i++) {
            const t = jets.getAttribute('aT').getX(i), band = jets.getAttribute('aRibbon').getX(i);
            const seed = (band * 0.618034 + 0.17) % 1;
            const pulse = smooth(time, 0.26 + seed * 0.18, 0.83 + seed * 0.18)
                * (1 - smooth(time, T.morph, 2.1));
            const side = band % 2 ? 1 : -1;
            const reach = (0.40 + seed * 0.42) * pulse * this.lateralScale;
            const width = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 0.6) * (1 - t) * (0.018 + seed * 0.016) * pulse;
            const bend = Math.sin(t * 5.0 + band) * Math.sin(t * Math.PI) * 0.035;
            jetPositions.setXYZ(i, side * (0.025 + t * reach + bend), SOURCE.y + Math.sin(t * Math.PI * 0.72) * (0.17 + seed * 0.30) * pulse
                + jets.getAttribute('aSide').getX(i) * width,
                SOURCE.z + t * (0.14 + Math.sin(band * 2.4) * 0.16) * pulse);
        }
        jetPositions.needsUpdate = true; jets.computeVertexNormals();
    }

    /** Absolute-time poses make seek, interruption, replay and reduced motion deterministic. */
    update(time: number, _viewportHeight: number): void {
        if (this.disposed) return;
        this.time = time;
        this.cardClearance.value = smooth(time, T.rotation, T.morph + 0.16);
        this.transformation.update(time);
        const illumination = this.finished ? 0 : smooth(time, 0.20, 0.98) * (1 - smooth(time, T.morph, T.fade));
        this.rimLight.intensity = illumination * 1.4;
        this.accentLight.intensity = illumination * 0.7;
        for (let i = 0; i < this.atmosphere.length; i++) {
            const mesh = this.atmosphere[i]!;
            mesh.material.uniforms.uOpacity.value = illumination * (i === 0 ? 0.17 : i === 1 ? 0.88 : 0.13);
            mesh.material.uniforms.uTime.value = time;
            mesh.visible = illumination > 0.001;
        }
        this.updateRibbons(time); this.updateSource(time);
        const energy = this.finished ? 0 : smooth(time, 0.12, 0.78) * (1 - smooth(time, T.rotation, 1.95));
        this.filament.material.uniforms.uOpacity.value = energy * 1.15;
        this.filament.material.uniforms.uTime.value = time;
        this.energizedJets.material.uniforms.uOpacity.value = energy * 0.65;
        this.energizedJets.material.uniforms.uTime.value = time;
        this.ribbons.visible = !this.finished && time > 0.02 && time < 3.12;
        this.filament.visible = this.energizedJets.visible = energy > 0.001;
        this.jets.visible = !this.finished && time > 0.32 && time < 1.85;
        for (const drop of this.droplets) {
            const age = time - drop.birth;
            const landing = drop.settled ? 2 * drop.velocity.y / 4.1 : drop.life;
            const live = age >= 0 && age < landing && !this.finished;
            const settle = drop.settled && age >= landing;
            const flightAge = Math.max(0, drop.settled ? Math.min(age, landing) : age);
            earthPosition(this.dummy.position, drop.base, drop.velocity, flightAge, 4.1);
            earthRotation(this.dummy.quaternion, this.spin, drop.rotation, drop.axis, flightAge, drop.spin);
            let size = live ? smooth(age, 0, 0.045) * (1 - smooth(age, drop.life * 0.68, drop.life)) : 0;
            if (drop.settled && age >= 0) size = smooth(age, 0, 0.045) * (1 - smooth(age, landing * 0.7, landing) * 0.25);
            if (settle) this.dummy.position.y = drop.base.y;
            // Keep the late fan beside/behind the card rather than across the image.
            this.dummy.position.z = THREE.MathUtils.lerp(this.dummy.position.z, Math.min(this.dummy.position.z, 0.12), smooth(time, T.rotation, T.morph + 0.25));
            this.dummy.scale.copy(drop.scale).multiplyScalar(size);
            this.dummy.updateMatrix(); drop.mesh.setMatrixAt(drop.index, this.dummy.matrix);
            if (drop.hero && drop.index < 4) this.glints[6 + drop.index]!.position.copy(this.dummy.position);
        }
        for (const mesh of this.debris) mesh.instanceMatrix.needsUpdate = true;
        for (let i = 0; i < this.glints.length; i++) {
            const sprite = this.glints[i]!;
            const band = i % 2, t = 0.22 + (i % 4) * 0.17;
            if (i < 6) this.ribbonPoint(sprite.position, t, band, time);
            const pulse = Math.pow(Math.max(0, Math.sin(time * 5.2 + i * 2.7)), 28);
            const strength = pulse * smooth(time, 0.45, 0.95) * (1 - smooth(time, T.rotation - 0.15, T.morph));
            sprite.material.opacity = strength * 0.85;
            sprite.material.rotation = i * 0.7 + time * 0.25;
            sprite.scale.setScalar(0.11 + pulse * 0.07);
            sprite.visible = !this.finished && strength > 0.01;
        }
    }

    reset(): void {
        if (this.disposed) return;
        this.finished = false; this.tail.progress = 0;
        this.transformation.reset(); this.update(0, 800);
    }

    finish(): void {
        this.finished = true;
        this.transformation.finish(); this.update(T.complete + 0.25, 800);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.transformation.dispose();
        const geometries = new Set([this.ribbons.geometry, this.filament.geometry, this.jets.geometry, ...this.debris.map(mesh => mesh.geometry)]);
        for (const geometry of geometries) geometry.dispose();
        for (const glint of this.glints) glint.material.dispose();
        this.metal.dispose(); this.filament.material.dispose();
        this.energizedJets.material.dispose();
        for (const mesh of this.atmosphere) { mesh.geometry.dispose(); mesh.material.dispose(); }
        this.rimLight.dispose(); this.accentLight.dispose();
        this.brushLease?.release();
        this.glintTexture.dispose(); this.brush.dispose(); this.environment.dispose();
        this.root.removeFromParent();
    }
}
