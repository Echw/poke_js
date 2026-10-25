import * as THREE from 'three';

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
        gl_FragColor = vec4(color, alpha);
        #if defined(ELECTRIC) || defined(GRASS)
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

    constructor(card: THREE.Mesh, palette: 'psychic' | 'electric' | 'grass' = 'psychic') {
        const electric = palette === 'electric';
        card.add(this.root);
        const geometry = new THREE.PlaneGeometry(1.20, 1.40);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uMorph: { value: 0 }, uOpacity: { value: 0 },
                uFill: { value: 1 }, uCorners: { value: 0 },
                uBase: { value: palette === 'psychic' ? new THREE.Vector3(0.76, 0.35, 1.0)
                    : new THREE.Color(palette === 'electric' ? 0xffb800 : 0x66c91c) },
                uHot: { value: palette === 'psychic' ? new THREE.Vector3(1.0, 0.89, 1.0)
                    : new THREE.Color(palette === 'electric' ? 0xfffdeb : 0xeaffad) },
                ...(electric ? {
                    uElectricActivity: { value: 0 },
                } : {}),
            },
            defines: electric ? { ELECTRIC: 1 } : palette === 'grass' ? { GRASS: 1 } : {},
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


        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 320;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Card glow canvas unavailable');
        context.beginPath();
        context.roundRect(47, 46, 162, 228, 12);
        context.strokeStyle = electric ? 'rgba(255, 212, 0, 0.72)' : palette === 'grass'
            ? 'rgba(146, 238, 60, 0.54)' : 'rgba(207, 103, 255, 0.72)';
        context.shadowColor = electric ? '#ffb800' : palette === 'grass' ? '#82db35' : '#d86cff';
        context.shadowBlur = palette === 'grass' ? 20 : 26;
        context.lineWidth = palette === 'grass' ? 7 : 9;
        context.stroke();
        context.shadowBlur = 9;
        context.strokeStyle = electric ? 'rgba(255, 253, 235, 0.92)' : palette === 'grass'
            ? 'rgba(237, 255, 190, 0.76)' : 'rgba(255, 233, 255, 0.92)';
        context.lineWidth = palette === 'grass' ? 2 : 3;
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
        this.root.visible = active;
    }

    update(time: number, morph: number, opacity: number, fill: number, corners: number, cardImage: number,
        electricActivity = 0): void {
        const uniforms = this.mesh.material.uniforms;
        uniforms.uTime.value = time;
        uniforms.uMorph.value = morph;
        uniforms.uOpacity.value = opacity;
        uniforms.uFill.value = fill;
        uniforms.uCorners.value = corners;
        if (uniforms.uElectricActivity) uniforms.uElectricActivity.value = electricActivity;
        this.mesh.visible = opacity > 0.001 || electricActivity > 0.001;
        this.glow.material.opacity = cardImage * 0.64;
        this.glow.visible = this.glow.material.opacity > 0.001;
    }

    dispose(): void {
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
