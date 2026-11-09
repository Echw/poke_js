import * as THREE from 'three';
import type { RevealPalette } from './cardTransformation';
import { createFrozenCardMaterial } from './iceMaterial';
import { spectralFlowGLSL } from './ghostVolume';

const vertexShader = /* glsl */ `
    varying vec2 vUv;
    #ifdef NORMAL
    uniform mat4 uCardToBall;
    varying vec3 vBallPosition;
    #endif
    void main() {
        vUv = uv;
        #ifdef NORMAL
        vBallPosition=(uCardToBall*vec4(position,1.0)).xyz;
        #endif
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

    #ifdef NORMAL
    uniform float uNormalSourceLight;
    varying vec3 vBallPosition;
    #endif

    #ifdef DARK
    ${spectralFlowGLSL}
    #endif

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
        #ifdef ROCK
        float veins=pow(1.0-abs(sin(p.x*24.0+p.y*13.0+sin(p.y*19.0)*0.9)),12.0);
        alpha=uOpacity*(fill*uFill*(0.50+veins*0.32)+edge*1.20+halo*0.20+corners*0.60);
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
        #ifdef DRAGON
        float fold=sin(p.y*17.0-p.x*9.0-uTime*2.5
            +sin(p.x*15.0+uTime)*1.3+sin(p.y*29.0+p.x*21.0-uTime)*0.65);
        float vein=pow(1.0-abs(fold),12.0);
        vec2 cell=floor(p*65.0);
        float seed=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
        float star=exp(-dot(fract(p*65.0)-0.5,fract(p*65.0)-0.5)*85.0)*step(0.96,seed);
        alpha=uOpacity*(fill*uFill*(0.42+vein*0.28+star*0.80)+edge*0.70+halo*0.12+corners*0.20);
        color=mix(uBase,vec3(0.30,0.015,0.85),fold*0.5+0.5);
        color=mix(color,uHot,clamp(edge*0.75+corners*0.22+vein*0.25+star,0.0,1.0));
        #endif
        #ifdef DARK
        float shadowFold = spectralMatter(vec3(p*0.7,0.21),uTime*0.55);
        float thinEdge = exp(-abs(distanceToShape)*100.0);
        color = mix(vec3(0.005,0.0002,0.001),vec3(0.025,0.0007,0.007),shadowFold*shadowFold);
        color = mix(color,uHot,clamp(thinEdge*0.95+corners*0.10,0.0,1.0));
        alpha = uOpacity*(fill*uFill*0.94+thinEdge*0.92+halo*0.10);
        #endif
        #ifdef FAIRY
        float fold=sin(p.y*14.0-p.x*8.0-uTime*1.2+sin(p.x*13.0+uTime*0.5));
        float filament=pow(1.0-abs(fold),16.0);
        vec2 cell=floor(p*53.0),point=fract(p*53.0)-0.5;
        float seed=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
        float dust=exp(-dot(point,point)*95.0)*step(0.975,seed);
        alpha=uOpacity*(fill*uFill*(0.14+filament*0.13+dust*0.65)+edge*0.88+halo*0.12+corners*0.22);
        color=mix(uBase,uHot,clamp(edge*0.85+filament*0.30+dust,0.0,1.0));
        #endif
        #ifdef STEEL
        alpha = min(1.0, uOpacity * (fill * uFill * 1.6 + edge * 0.88 + halo * 0.08 + corners * 0.18));
        color = mix(uBase, uHot, clamp(edge * 0.95 + corners * 0.20, 0.0, 1.0));
        #endif
        #ifdef NORMAL
        // ShaderMaterial ignores PointLight: supply a separate, local source bounce.
        vec3 delta=vBallPosition-vec3(0.0,-0.065,0.46);
        float bounce=uNormalSourceLight/(1.0+dot(delta,delta)*24.0);
        alpha=uOpacity*(fill*uFill*0.16+edge*0.60+halo*0.08+corners*0.26+bounce*fill*0.26);
        color=mix(uBase,uHot,clamp(edge+bounce,0.0,1.0));
        #endif
        gl_FragColor = vec4(color, alpha);
        #if defined(ELECTRIC) || defined(GRASS) || defined(FIRE) || defined(WATER) || defined(FIGHTING) || defined(POISON) || defined(ROCK) || defined(DRAGON) || defined(DARK) || defined(STEEL) || defined(FAIRY) || defined(NORMAL)
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
        const spectral = palette === 'poison' || palette === 'ghost';
        card.add(this.root);
        const geometry = new THREE.PlaneGeometry(1.20, 1.40);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uMorph: { value: 0 }, uOpacity: { value: 0 },
                uFill: { value: 1 }, uCorners: { value: 0 },
                uBase: { value: palette === 'psychic' ? new THREE.Vector3(0.76, 0.35, 1.0)
                    : new THREE.Color(palette === 'flying' ? 0x8ab9ff : palette === 'ground' ? 0xe2a045 : spectral ? 0xbd21f5 : palette === 'fighting' ? 0xff390b : palette === 'ice' ? 0x80d8ff : palette === 'water' ? 0x139eff : palette === 'electric' ? 0xffb800 : palette === 'fire' ? 0xff4a08 : 0x66c91c) },
                uHot: { value: palette === 'psychic' ? new THREE.Vector3(1.0, 0.89, 1.0)
                    : new THREE.Color(palette === 'flying' ? 0xf3f8ff : palette === 'ground' ? 0xffe6ad : spectral ? 0xffddff : palette === 'fighting' ? 0xffd28a : palette === 'ice' ? 0xebfbff : palette === 'water' ? 0xe2faff : palette === 'electric' ? 0xfffdeb : palette === 'fire' ? 0xfff0b0 : 0xeaffad) },
                ...(electric ? {
                    uElectricActivity: { value: 0 },
                } : {}),
            },
            defines: electric ? { ELECTRIC: 1 } : palette === 'grass' ? { GRASS: 1 }
                : spectral ? { POISON: 1 } : palette === 'fighting' ? { FIGHTING: 1 } : palette === 'fire' ? { FIRE: 1 } : palette === 'flying' || palette === 'water' || palette === 'ice' || palette === 'ground' ? { WATER: 1 } : {},
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
        if (palette === 'normal') {
            material.defines.NORMAL = 1;
            material.toneMapped = false;
            material.uniforms.uCardToBall = { value: new THREE.Matrix4() };
            material.uniforms.uNormalSourceLight = { value: 0 };
            material.uniforms.uBase.value = new THREE.Color(0xfff0de);
            material.uniforms.uHot.value = new THREE.Color(0xffffff);
        }
        if (palette === 'fairy') {
            material.defines.FAIRY = 1;
            material.toneMapped = false;
            material.uniforms.uBase.value = new THREE.Color(0xff459b);
            material.uniforms.uHot.value = new THREE.Color(0xffebf5);
        }
        if (palette === 'steel') {
            material.defines.STEEL = 1;
            material.blending = THREE.NormalBlending;
            material.uniforms.uBase.value = new THREE.Color(0xd4dce9);
            material.uniforms.uHot.value = new THREE.Color(0xf4f8ff);
        }
        if (palette === 'dark') {
            material.defines.DARK = 1;
            material.blending = THREE.NormalBlending;
            material.toneMapped = false;
            material.uniforms.uBase.value = new THREE.Color(0x20020c);
            material.uniforms.uHot.value = new THREE.Color(0xff2559);
        }
        if (palette === 'rock') {
            material.uniforms.uBase.value = new THREE.Color(0xe6b975);
            material.uniforms.uHot.value = new THREE.Color(0xfff2d1);
            material.defines.ROCK = 1;
        }
        this.mesh.position.z = 0.025;
        if (palette === 'dragon') {
            material.defines.DRAGON = 1;
            material.toneMapped = false;
            this.mesh.material.uniforms.uBase.value = new THREE.Color(0x305dff);
            this.mesh.material.uniforms.uHot.value = new THREE.Color(0xeffaff);
        }
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
        if (palette === 'rock') {
            context.strokeStyle = 'rgba(239, 199, 139, 0.46)';
            context.shadowColor = '#ffdda0';
            context.shadowBlur = 18;
        }
        if (palette === 'dragon') {
            context.strokeStyle = 'rgba(90, 97, 255, 0.55)';
            context.shadowColor = '#652dff';
        }
        context.lineWidth = palette === 'grass' ? 7 : 9;
        if (palette === 'fairy') {
            context.strokeStyle = 'rgba(255, 115, 180, 0.40)';
            context.shadowColor = '#ff78bd'; context.shadowBlur = 18;
            context.lineWidth = 5;
        }
        if (palette === 'dark') {
            context.strokeStyle = 'rgba(229, 6, 60, 0.50)';
            context.shadowColor = '#d60035'; context.shadowBlur = 16;
            context.lineWidth = 5;
        }
        if (palette === 'steel') {
            context.strokeStyle = 'rgba(191, 209, 238, 0.40)';
            context.shadowColor = '#dce8ff'; context.shadowBlur = 14;
            context.lineWidth = 5;
        }
        if (palette === 'normal') {
            context.strokeStyle = 'rgba(255, 242, 224, 0.32)';
            context.shadowColor = '#fff5e9'; context.shadowBlur = 14;
            context.lineWidth = 4;
        }
        context.stroke();
        context.shadowBlur = 9;
        context.strokeStyle = palette === 'flying' ? 'rgba(236, 246, 255, 0.75)' : palette === 'ground' ? 'rgba(255, 222, 160, 0.75)' : palette === 'fighting' ? 'rgba(255, 190, 110, 0.9)' : palette === 'ice' || palette === 'water' ? 'rgba(215, 250, 255, 0.75)' : electric ? 'rgba(255, 253, 235, 0.92)' : palette === 'grass'
            ? 'rgba(237, 255, 190, 0.76)' : palette === 'fire'
                ? 'rgba(255, 184, 75, 0.90)' : 'rgba(255, 233, 255, 0.92)';
        context.lineWidth = palette === 'grass' || palette === 'fire' ? 2 : 3;
        if (palette === 'bug') context.strokeStyle = 'rgba(255, 255, 198, 0.72)';
        if (palette === 'rock') context.strokeStyle = 'rgba(255, 242, 209, 0.70)';
        if (palette === 'dark') context.strokeStyle = 'rgba(255, 75, 110, 0.68)';
        if (palette === 'steel') context.strokeStyle = 'rgba(244, 249, 255, 0.78)';
        if (palette === 'fairy') context.strokeStyle = 'rgba(255, 228, 242, 0.68)';
        if (palette === 'normal') context.strokeStyle = 'rgba(255, 253, 247, 0.64)';
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
        if (uniforms.uCardToBall) {
            this.card.updateMatrix(); this.mesh.updateMatrix();
            uniforms.uCardToBall.value.multiplyMatrices(this.card.matrix, this.mesh.matrix);
            uniforms.uNormalSourceLight.value = (1 - cardImage) * (0.65 - morph * 0.25);
        }
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
