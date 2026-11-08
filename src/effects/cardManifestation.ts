import * as THREE from 'three';
import type { RevealPalette } from './cardTransformation';
import { createFrozenCardMaterial } from './iceMaterial';

const vertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    uniform float uTime;
    uniform float uMorph;
    uniform float uOpacity;
    uniform float uFill;
    uniform float uCorners;
    uniform vec3 uBase;
    uniform vec3 uHot;
    #ifdef ELECTRIC
    uniform float uElectricActivity;
    #endif
    varying vec2 vUv;

    float roundedBox(vec2 p, vec2 halfSize, float radius) {
        vec2 q = abs(p) - halfSize + radius;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    }

    void main() {
        vec2 p = (vUv - 0.5) * vec2(1.20, 1.40);
        float orb = length(p) - 0.42;
        float card = roundedBox(p, vec2(0.35, 0.50), 0.045);
        float distanceToShape = mix(orb, card, smoothstep(0.0, 1.0, uMorph));
        #ifdef BUG_DEPTH
        if (distanceToShape > -0.008) discard;
        gl_FragColor = vec4(0.0);
        return;
        #endif
        float edge = exp(-abs(distanceToShape) * 43.0);
        float halo = exp(-abs(distanceToShape) * 10.0);
        float fill = 1.0 - smoothstep(-0.03, 0.035, distanceToShape);
        float corners = 0.0;
        for (int x = -1; x <= 1; x += 2) {
            for (int y = -1; y <= 1; y += 2) {
                vec2 corner = vec2(float(x) * 0.315, float(y) * 0.465);
                float radius = length(p - corner);
                corners += exp(-radius * radius * 110.0);
            }
        }
        corners *= uMorph * uCorners * (0.88 + 0.12 * sin(uTime * 12.0));
        float alpha = uOpacity * (fill * uFill * 0.31 + edge * 0.83 + halo * 0.18 + corners * 0.75);
        #ifdef GRASS
        alpha *= 0.76;
        #endif
        #ifdef FIRE
        alpha *= 0.55;
        #endif
        #ifdef WATER
        alpha *= 0.74;
        #endif
        #ifdef FIGHTING
        float folds=sin(p.y*19.0-uTime*4.0+sin(p.x*13.0+uTime*2.0));
        alpha=uOpacity*(fill*uFill*(0.42+0.18*folds*folds)+edge*1.35+halo*0.26+corners*0.9);
        #endif
        #ifdef POISON
        float folds=sin(p.y*15.0-uTime*2.0+sin(p.x*17.0+uTime));
        alpha=uOpacity*(fill*uFill*(0.14+0.12*folds*folds)+edge*1.05+halo*0.18+corners*0.6);
        #endif
        #ifdef ELECTRIC
        float crawlA = pow(max(0.0, sin((p.x * 1.25 - p.y * 0.85) * 21.0 - uTime * 17.0)), 12.0);
        float crawlB = pow(max(0.0, sin((p.x * 0.65 + p.y * 1.40) * 17.0 + uTime * 13.0)), 15.0);
        float electricPulse = edge * (crawlA * 0.75 + crawlB * 0.55) * uElectricActivity;
        alpha += electricPulse;
        vec3 color = mix(uBase, uHot, clamp((edge + corners) * 0.58, 0.0, 1.0));
        color = mix(color, uHot, clamp(electricPulse * 1.6, 0.0, 1.0));
        #else
        vec3 color = mix(uBase, uHot, clamp(edge + corners, 0.0, 1.0));
        #endif
        #ifdef FIRE
        color = mix(uBase, uHot, clamp(pow(edge, 5.0) * 0.40 + corners * 0.22, 0.0, 1.0));
        #endif
        gl_FragColor = vec4(color, alpha);
        #if defined(ELECTRIC) || defined(GRASS) || defined(FIRE) || defined(WATER) || defined(FIGHTING) || defined(POISON)
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #endif
    }
`;

/** A luminous orb becomes a card outline before the card image is revealed. */
export class CardManifestation {
    readonly root = new THREE.Group();
    readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    private readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    private readonly card: THREE.Mesh;
    private readonly originalMaterials: THREE.Material | THREE.Material[];
    private readonly frozenMaterials: THREE.MeshBasicMaterial[] = [];
    private readonly iceImage = { value: 0 };
    private active = false;
    private readonly bugDepth?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

    constructor(card: THREE.Mesh, palette: RevealPalette = 'psychic', environment?: THREE.Texture) {
        this.card = card;
        this.originalMaterials = card.material;
        if (palette === 'ice' && environment) {
            const originals = Array.isArray(card.material) ? card.material : [card.material];
            this.frozenMaterials.push(...originals.map(material =>
                createFrozenCardMaterial(material as THREE.MeshBasicMaterial, environment, this.iceImage)));
        }
        const electric = palette === 'electric';
        card.add(this.root);
        const geometry = new THREE.PlaneGeometry(1.20, 1.40);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uMorph: { value: 0 }, uOpacity: { value: 0 },
                uFill: { value: 1 }, uCorners: { value: 0 },
                uBase: { value: palette === 'psychic' ? new THREE.Vector3(0.76, 0.35, 1.0)
                    : new THREE.Color(palette === 'flying' ? 0x8ab9ff : palette === 'ground' ? 0xe2a045 : palette === 'poison' ? 0xbd21f5 : palette === 'fighting' ? 0xff390b : palette === 'ice' ? 0x80d8ff : palette === 'water' ? 0x139eff : palette === 'electric' ? 0xffb800 : palette === 'fire' ? 0xff4a08 : 0x66c91c) },
                uHot: { value: palette === 'psychic' ? new THREE.Vector3(1.0, 0.89, 1.0)
                    : new THREE.Color(palette === 'flying' ? 0xf3f8ff : palette === 'ground' ? 0xffe6ad : palette === 'poison' ? 0xffddff : palette === 'fighting' ? 0xffd28a : palette === 'ice' ? 0xebfbff : palette === 'water' ? 0xe2faff : palette === 'electric' ? 0xfffdeb : palette === 'fire' ? 0xfff0b0 : 0xeaffad) },
                ...(electric ? {
                    uElectricActivity: { value: 0 },
                } : {}),
            },
            defines: electric ? { ELECTRIC: 1 } : palette === 'grass' ? { GRASS: 1 }
                : palette === 'poison' ? { POISON: 1 } : palette === 'fighting' ? { FIGHTING: 1 } : palette === 'fire' ? { FIRE: 1 } : palette === 'flying' || palette === 'water' || palette === 'ice' || palette === 'ground' ? { WATER: 1 } : {},
            vertexShader,
            fragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            forceSinglePass: palette !== 'psychic',
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.z = 0.025;
        this.mesh.renderOrder = 4;
        this.root.add(this.mesh);
        if (palette === 'bug') {
            material.uniforms.uBase.value = new THREE.Color(0xc2e52d);
            material.uniforms.uHot.value = new THREE.Color(0xffffc5);
            material.defines.GRASS = 1;
            const depth = material.clone();
            depth.uniforms = material.uniforms;
            depth.defines = { BUG_DEPTH: 1 };
            depth.colorWrite = false; depth.depthWrite = true;
            this.bugDepth = new THREE.Mesh(geometry, depth);
            this.bugDepth.name = 'BugCardDepth';
            this.bugDepth.position.z = -0.015;
            this.bugDepth.renderOrder = 0;
            this.bugDepth.visible = false;
            this.root.add(this.bugDepth);
        }


        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 320;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Card glow canvas unavailable');
        context.beginPath();
        context.roundRect(47, 46, 162, 228, 12);
        context.strokeStyle = palette === 'flying' ? 'rgba(132, 181, 255, 0.48)' : palette === 'ground' ? 'rgba(235, 161, 64, 0.48)' : palette === 'fighting' ? 'rgba(255, 51, 8, 0.7)' : palette === 'ice' ? 'rgba(150, 225, 255, 0.55)' : palette === 'water' ? 'rgba(22, 162, 255, 0.55)' : electric ? 'rgba(255, 212, 0, 0.72)' : palette === 'grass'
            ? 'rgba(146, 238, 60, 0.54)' : palette === 'fire'
                ? 'rgba(255, 74, 8, 0.70)' : 'rgba(207, 103, 255, 0.72)';
        context.shadowColor = palette === 'flying' ? '#85b6ff' : palette === 'ground' ? '#d89534' : palette === 'fighting' ? '#ee2105' : palette === 'ice' ? '#82dcff' : palette === 'water' ? '#159bff' : electric ? '#ffb800' : palette === 'grass' ? '#82db35'
            : palette === 'fire' ? '#d71908' : '#d86cff';
        context.shadowBlur = palette === 'grass' ? 20 : palette === 'fire' ? 22 : 26;
        if (palette === 'bug') {
            context.strokeStyle = 'rgba(202, 235, 48, 0.45)';
            context.shadowColor = '#c5e831';
            context.shadowBlur = 18;
        }
        context.lineWidth = palette === 'grass' ? 7 : 9;
        context.stroke();
        context.shadowBlur = 9;
        context.strokeStyle = palette === 'flying' ? 'rgba(236, 246, 255, 0.75)' : palette === 'ground' ? 'rgba(255, 222, 160, 0.75)' : palette === 'fighting' ? 'rgba(255, 190, 110, 0.9)' : palette === 'ice' || palette === 'water' ? 'rgba(215, 250, 255, 0.75)' : electric ? 'rgba(255, 253, 235, 0.92)' : palette === 'grass'
            ? 'rgba(237, 255, 190, 0.76)' : palette === 'fire'
                ? 'rgba(255, 184, 75, 0.90)' : 'rgba(255, 233, 255, 0.92)';
        context.lineWidth = palette === 'grass' || palette === 'fire' ? 2 : 3;
        if (palette === 'bug') context.strokeStyle = 'rgba(255, 255, 198, 0.72)';
        context.stroke();
        const glowTexture = new THREE.CanvasTexture(canvas);
        glowTexture.colorSpace = THREE.SRGBColorSpace;
        const glowMaterial = new THREE.MeshBasicMaterial({
            map: glowTexture, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthTest: true, depthWrite: false,
            side: THREE.FrontSide, toneMapped: false,
        });
        this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1.10, 1.40), glowMaterial);
        this.glow.position.z = 0.035;
        this.glow.renderOrder = 5;
        this.root.add(this.glow);
    }

    setActive(active: boolean): void {
        this.active = active;
        this.root.visible = active;
        if (this.frozenMaterials.length) this.card.material = active ? this.frozenMaterials : this.originalMaterials;
    }

    /** The formed Ice plate is an opaque occluder even before its artwork appears. */
    get cardDepthVisible(): boolean {
        return this.active && this.frozenMaterials.some(material => material.visible);
    }

    update(time: number, morph: number, opacity: number, fill: number, corners: number, cardImage: number,
        electricActivity = 0): void {
        const uniforms = this.mesh.material.uniforms;
        if (this.frozenMaterials.length) {
            this.iceImage.value = cardImage;
            const originals = this.originalMaterials as THREE.MeshBasicMaterial[];
            this.frozenMaterials.forEach((material, i) => {
                material.visible = time >= 1.45;
                if (material.map !== originals[i].map) {
                    material.map = originals[i].map;
                    material.needsUpdate = true;
                }
            });
        }
        uniforms.uTime.value = time;
        uniforms.uMorph.value = morph;
        uniforms.uOpacity.value = opacity;
        // Ice keeps the existing luminous outline over its solid frozen surface.
        uniforms.uFill.value = this.frozenMaterials.length ? 0 : fill;
        uniforms.uCorners.value = corners;
        if (uniforms.uElectricActivity) uniforms.uElectricActivity.value = electricActivity;
        this.mesh.visible = opacity > 0.001 || electricActivity > 0.001;
        if (this.bugDepth) this.bugDepth.visible = this.active && morph > 0.02;
        const frozenGlow = this.frozenMaterials.length ? THREE.MathUtils.smoothstep(time, 1.45, 1.7) : 0;
        this.glow.material.opacity = Math.max(cardImage, frozenGlow) * 0.64;
        if (this.bugDepth) this.glow.material.opacity *= 0.58;
        this.glow.visible = this.glow.material.opacity > 0.001;
    }

    dispose(): void {
        this.bugDepth?.material.dispose();
        if (this.frozenMaterials.length && this.card.material === this.frozenMaterials) this.card.material = this.originalMaterials;
        this.frozenMaterials.forEach(material => material.dispose());
        this.root.removeFromParent();
        this.mesh.removeFromParent();
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.glow.removeFromParent();
        this.glow.geometry.dispose();
        this.glow.material.map?.dispose();
        this.glow.material.dispose();
    }
}
