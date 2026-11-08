import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CardManifestation } from './cardManifestation';
import { fightingImpulse } from './smokeProfile';

export type RevealPalette = 'psychic' | 'electric' | 'grass' | 'fire' | 'water' | 'ice' | 'fighting' | 'poison' | 'ground';

/** Shared handoff times, in seconds from the Ball opening. */
export const CARD_REVEAL_TIMING = {
    rotation: 1.35, morph: 1.45, corners: 1.70, image: 2.15,
    fade: 2.85, complete: 3.5, morphDuration: 0.70,
} as const;

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

// Psychic retains its original output path; Electric and Grass use linear colors.
const coreFragment = /* glsl */ `
    uniform float uOpacity;
    uniform float uTime;
    uniform vec3 uBase;
    uniform vec3 uHot;
    uniform vec3 uRim;
    varying vec3 vNormal;
    varying vec3 vView;
    varying float vDisplacement;
    void main() {
        float facing = max(0.0, dot(normalize(vNormal), normalize(vView)));
        float fresnel = pow(1.0 - facing, 2.1);
        float pulse = 0.88 + 0.12 * sin(uTime * 10.0);
        #ifdef GRASS_SOURCE
        vec3 color = mix(uBase, uHot, pow(facing, 0.40));
        color += fresnel * uRim * 0.35 + vDisplacement * 0.035;
        float softEdge = smoothstep(0.02, 0.72, facing);
        gl_FragColor = vec4(color * pulse, uOpacity * softEdge * 0.76);
        #else
        vec3 color = mix(uBase, uHot, pow(facing, 0.9));
        color += fresnel * uRim + vDisplacement * 0.06;
        #ifdef FIRE_SOURCE
        color = mix(uRim, uBase, smoothstep(0.0, 0.80, facing));
        color = mix(color, uHot, pow(facing, 8.0) * 0.90);
        #endif
        #ifdef WATER_SOURCE
        color = mix(uBase, uHot * 1.8, pow(facing, 3.0));
        #endif
        #ifdef FIGHTING_SOURCE
        color = mix(uHot * 1.6, uHot * 3.0, smoothstep(0.0, 0.75, facing));
        #endif
        gl_FragColor = vec4(color * pulse, uOpacity);
        #endif
        #ifdef COLOR_MANAGED
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #endif
    }
`;

const glowVertex = /* glsl */ `
    #ifdef GRASS_GLOW
    attribute float aLayer;
    varying float vLayer;
    #endif
    varying vec2 vUv;
    void main() {
        vUv = uv;
        #ifdef GRASS_GLOW
        vLayer = aLayer;
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const glowFragment = /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uCenterSharpness;
    uniform float uHaloSharpness;
    uniform float uHaloStrength;
    #ifdef ICE_GLOW
    uniform float uIceCore;
    #endif
    #ifdef FIRE_GLOW
    uniform vec3 uFireWarm;
    #endif
    #ifdef GRASS_GLOW
    varying float vLayer;
    #endif
    varying vec2 vUv;
    void main() {
        float d = length(vUv - 0.5) * 2.0;
        float center = exp(-d * d * uCenterSharpness);
        float halo = exp(-d * d * uHaloSharpness) * uHaloStrength;
        float layer = 1.0;
        #ifdef GRASS_GLOW
        layer = vLayer;
        layer *= 1.0 - smoothstep(0.58, 0.96, d);
        if (vLayer < 0.5) {
            vec2 p = (vUv - 0.5) * 2.0;
            float warp = 0.27 * sin(p.y * 5.0 - uTime * 0.9);
            float fold = sin((p.x + warp) * 10.0 + p.y * 3.0 + uTime * 1.4);
            float fine = sin(p.x * 19.0 - p.y * 12.0 + uTime * 2.3);
            float veil = smoothstep(-0.35, 0.70, fold)
                * (0.53 + 0.47 * smoothstep(-0.5, 0.7, fine));
            float bounds = 1.0 - smoothstep(0.60, 0.96, max(abs(p.x), abs(p.y)));
            layer *= (0.18 + 0.82 * veil) * bounds;
        }
        #endif
        vec3 color = uColor;
        #ifdef FIRE_GLOW
        color = mix(uColor, uFireWarm, center * center * 0.65);
        layer *= 0.72;
        #endif
        #ifdef ICE_GLOW
        float whiteCore=exp(-d*d*80.0);
        color=mix(uColor,vec3(1.3,2.0,2.5),whiteCore*0.82);
        gl_FragColor=vec4(color,(center*0.65+halo+whiteCore*uIceCore)*uOpacity*layer);
        #else
        gl_FragColor = vec4(color, (center + halo) * uOpacity * layer);
        #endif
        #ifdef COLOR_MANAGED
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #endif
    }
`;

/** Shared energy source and orb-to-card animation; type VFX remain with each effect. */
export class CardTransformation {
    readonly root = new THREE.Group();
    readonly state = { core: 0, energy: 0, morph: 0, silhouette: 0, corners: 0, cardImage: 0, fade: 1 };
    private readonly manifestation: CardManifestation;
    private readonly core: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
    private readonly glows: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
    private readonly fadeSourceWithCard: boolean;
    private readonly ice: boolean;
    private readonly fighting: boolean;
    private readonly poison: boolean;
    private readonly ground: boolean;
    private finished = false;

    constructor(card: THREE.Mesh, palette: RevealPalette, mobile = false, environment?: THREE.Texture) {
        this.ice = palette === 'ice';
        this.fighting = palette === 'fighting';
        this.poison = palette === 'poison';
        this.ground = palette === 'ground';
        this.fadeSourceWithCard = palette !== 'psychic';
        this.manifestation = new CardManifestation(card, palette, environment);
        this.manifestation.setActive(false);
        const psychic = palette === 'psychic';
        const coreMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uOpacity: { value: 0 },
                uBase: { value: psychic ? new THREE.Vector3(0.55, 0.19, 0.91)
                    : new THREE.Color(palette === 'ground' ? 0xd9973c : palette === 'poison' ? 0x70139b : palette === 'ice' ? 0x68c9ed : palette === 'water' ? 0x188cff : palette === 'electric' ? 0xffe788 : palette === 'fire' ? 0xff8a16 : 0x71d645) },
                uHot: { value: psychic ? new THREE.Vector3(1.0, 0.88, 1.0)
                    : new THREE.Color(palette === 'ground' ? 0xffe3a3 : palette === 'poison' ? 0xffceff : palette === 'water' ? 0xddfaff : palette === 'grass' ? 0xfcfff2 : palette === 'fire' ? 0xfff0b0 : 0xffffff) },
                uRim: { value: psychic ? new THREE.Vector3(0.33, 0.17, 0.48)
                    : new THREE.Color(palette === 'ground' ? 0x753509 : palette === 'poison' ? 0xa521d5 : palette === 'ice' ? 0x2e89b6 : palette === 'water' ? 0x004ba8 : palette === 'electric' ? 0x703000 : palette === 'fire' ? 0xd71908 : 0x236818) },
            },
            vertexShader: coreVertex,
            fragmentShader: coreFragment,
            defines: psychic ? {} : palette === 'grass'
                ? { COLOR_MANAGED: 1, GRASS_SOURCE: 1 }
                : palette === 'fire' ? { COLOR_MANAGED: 1, FIRE_SOURCE: 1 }
                    : palette === 'water' ? { COLOR_MANAGED: 1, WATER_SOURCE: 1 } : { COLOR_MANAGED: 1 },
            transparent: true,
            blending: THREE.NormalBlending,
            depthTest: true,
            depthWrite: false,
            side: palette === 'fire' || palette === 'water' ? THREE.FrontSide : THREE.DoubleSide,
            forceSinglePass: !psychic,
            ...(psychic ? {} : { toneMapped: false }),
        });
        this.core = new THREE.Mesh(
            new THREE.SphereGeometry(palette === 'ground' ? 0.045 : palette === 'poison' ? 0.045 : palette === 'ice' ? 0.055 : palette === 'water' ? 0.065 : palette === 'fire' ? 0.085 : 0.13,
                mobile ? 20 : 32, mobile ? 14 : 24), coreMaterial,
        );
        this.core.position.set(0, -0.07, palette === 'ice' || palette === 'water' || palette === 'ground' || palette === 'poison' ? 0.38 : palette === 'fire' ? 0.43 : 0.26);
        if (palette === 'fighting') {
            coreMaterial.uniforms.uBase.value = new THREE.Color(0xff3209);
            coreMaterial.uniforms.uHot.value = new THREE.Color(0xffe6a3);
            coreMaterial.uniforms.uRim.value = new THREE.Color(0xb30c05);
            coreMaterial.defines.FIGHTING_SOURCE = 1;
            this.core.geometry.dispose();
            this.core.geometry = new THREE.SphereGeometry(0.05, mobile ? 20 : 32, mobile ? 14 : 24);
            this.core.position.set(0, -0.07, 0.38);
        }
        // Transparent water is rendered first; the source still tests the Ball's depth.
        if (palette === 'water') this.core.renderOrder = 3;
        this.root.add(this.core);

        if (psychic) {
            this.addPsychicGlow(-0.05, 0.30, 0.82, 0xefa4ff, false);
            this.addPsychicGlow(-0.10, 0.14, 1.30, 0xa855f7, true);
        } else {
            const front = new THREE.PlaneGeometry(palette === 'water' || palette === 'ground' || palette === 'poison' ? 0.58 : 0.82, palette === 'water' || palette === 'ground' || palette === 'poison' ? 0.58 : 0.82);
            front.translate(0, -0.05, palette === 'ice' || palette === 'water' || palette === 'ground' || palette === 'poison' ? 0.39 : 0.30);
            const pool = new THREE.PlaneGeometry(palette === 'water' || palette === 'ground' || palette === 'poison' ? 1.05 : 1.30, palette === 'water' || palette === 'ground' || palette === 'poison' ? 1.05 : 1.30);
            pool.rotateX(-Math.PI / 2);
            pool.translate(0, -0.10, 0.14);
            const layers: THREE.PlaneGeometry[] = [front, pool];
            if (palette === 'grass') {
                const atmosphere = new THREE.PlaneGeometry(2.30, 2.00);
                atmosphere.translate(0, 0.45, 0.12);
                layers.push(atmosphere);
                for (const [index, layer] of layers.entries()) {
                    layer.setAttribute('aLayer', new THREE.Float32BufferAttribute(
                        new Array(layer.getAttribute('position').count).fill(index === 2 ? 0.23 : 1), 1));
                }
            }
            const geometry = mergeGeometries(layers);
            layers.forEach((layer) => layer.dispose());
            if (!geometry) throw new Error('Energy source glow geometry unavailable');
            const material = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(palette === 'ground' ? 0xffb64b : palette === 'poison' ? 0xc32aff : palette === 'fighting' ? 0xff3108 : palette === 'ice' ? 0x7ad8ff : palette === 'water' ? 0x139eff : palette === 'electric' ? 0xffc72b : palette === 'fire' ? 0xff4a08 : 0x9ced5f) },
                    ...(palette === 'fire' ? { uFireWarm: { value: new THREE.Color(0xff8a16) } } : {}),
                    uOpacity: { value: 0 }, uTime: { value: 0 },
                    uCenterSharpness: { value: palette === 'ground' ? 28 : palette === 'poison' ? 28 : palette === 'fighting' ? 22 : palette === 'fire' ? 16 : 8 },
                    uHaloSharpness: { value: palette === 'ice' ? 3.4 : palette === 'fire' ? 3.2 : 2.2 },
                    uHaloStrength: { value: palette === 'ground' ? 0.22 : palette === 'poison' ? 0.18 : palette === 'fighting' ? 0.16 : palette === 'ice' ? 0.68 : palette === 'water' ? 0.38 : palette === 'fire' ? 0.28 : 0.56 },
                    ...(palette === 'ice' ? { uIceCore: { value: 1.8 } } : {}),
                },
                vertexShader: glowVertex,
                fragmentShader: glowFragment,
                defines: palette === 'grass' ? { COLOR_MANAGED: 1, GRASS_GLOW: 1 }
                    : palette === 'fire' ? { COLOR_MANAGED: 1, FIRE_GLOW: 1 }
                        : palette === 'ice' ? { COLOR_MANAGED: 1, ICE_GLOW: 1 }
                        : { COLOR_MANAGED: 1 },
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthTest: palette === 'water' || palette === 'ice' || palette === 'fighting' || palette === 'ground' || palette === 'poison',
                depthWrite: false,
                side: THREE.DoubleSide,
                forceSinglePass: true,
            });
            const glow = new THREE.Mesh(geometry, material);
            if (palette === 'water') glow.renderOrder = 3.3;
            this.root.add(glow);
            this.glows.push(glow);
        }
    }

    private addPsychicGlow(y: number, z: number, size: number, color: THREE.ColorRepresentation, horizontal: boolean): void {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(color).convertLinearToSRGB() },
                uOpacity: { value: 0 },
                uCenterSharpness: { value: 11 },
                uHaloSharpness: { value: 3.5 },
                uHaloStrength: { value: 0.28 },
            },
            vertexShader: glowVertex,
            fragmentShader: glowFragment,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
        glow.position.set(0, y, z);
        if (horizontal) glow.rotation.x = -Math.PI / 2;
        this.root.add(glow);
        this.glows.push(glow);
    }

    /** Materialize every card on the same timeline, independent of its element. */
    addToTimeline(timeline: gsap.core.Timeline): void {
        timeline.to(this.state, { core: 1, duration: 0.4, ease: 'power2.out' }, 0);
        timeline.to(this.state, { energy: 1, duration: 0.4, ease: 'power3.out' }, 0.4);
        timeline.to(this.state, { morph: 1, silhouette: 1, duration: CARD_REVEAL_TIMING.morphDuration, ease: 'power2.inOut' }, CARD_REVEAL_TIMING.morph);
        timeline.to(this.state, { corners: 1, duration: 0.35, ease: 'power2.out' }, CARD_REVEAL_TIMING.corners);
        timeline.to(this.state, { cardImage: 1, duration: CARD_REVEAL_TIMING.fade - CARD_REVEAL_TIMING.image, ease: this.fighting ? 'power4.out' : this.ground ? 'power3.out' : 'power2.inOut' }, CARD_REVEAL_TIMING.image);
        timeline.to(this.state, { fade: 0, duration: CARD_REVEAL_TIMING.complete - CARD_REVEAL_TIMING.fade, ease: 'power2.inOut' }, CARD_REVEAL_TIMING.fade);
    }

    update(time: number, edgeActivity = 0): void {
        const { core, energy, morph, silhouette, corners, cardImage, fade } = this.state;
        const sourceOpacity = fade * (this.fadeSourceWithCard ? 1 - cardImage : 1);
        this.core.scale.setScalar(0.72 + energy * 0.35 + Math.sin(time * 11) * 0.055);
        this.core.material.uniforms.uTime.value = time;
        const burst = this.fighting ? fightingImpulse(time) : 0;
        this.core.scale.multiplyScalar(1 + burst * 0.7);
        this.core.material.uniforms.uOpacity.value = core * sourceOpacity * (1 - morph);
        for (const glow of this.glows) {
            if (glow.material.uniforms.uTime) glow.material.uniforms.uTime.value = time;
            glow.material.uniforms.uOpacity.value = (core * 0.65 + energy * 0.36)
                * sourceOpacity * (1 - morph * 0.5) * (this.ice ? 0.9 : this.ground ? 0.42 : this.poison ? 0.24 : 1) * (1 + burst * 1.7);
        }
        this.manifestation.update(time, morph,
            this.finished ? 0 : silhouette * fade * (1 - cardImage),
            1 - cardImage, this.finished ? 0 : corners, cardImage,
            this.finished ? 0 : edgeActivity);
    }

    setActive(active: boolean): void {
        this.root.visible = active && !this.finished;
        this.manifestation.setActive(active);
    }

    get cardDepthVisible(): boolean { return this.manifestation.cardDepthVisible; }

    reset(): void {
        this.finished = false;
        this.root.visible = true;
        Object.assign(this.state, { core: 0, energy: 0, morph: 0, silhouette: 0, corners: 0, cardImage: 0, fade: 1 });
        this.update(0);
    }

    finish(): void {
        this.finished = true;
        this.root.visible = false;
    }

    dispose(): void {
        this.root.removeFromParent();
        this.manifestation.dispose();
        this.core.geometry.dispose();
        this.core.material.dispose();
        for (const glow of this.glows) {
            glow.geometry.dispose();
            glow.material.dispose();
        }
    }
}
