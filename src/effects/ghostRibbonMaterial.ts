import * as THREE from 'three';
import { ribbonFragment } from './ribbonMaterial';

const vertexShader = /* glsl */ `
    uniform float uTime;
    attribute float aT;
    attribute float aSide;
    attribute float aRibbon;
    varying float vT;
    varying float vSide;
    varying float vNoise;
    varying float vRibbonStrength;

    void main() {
        float t = aT;
        float id = aRibbon;
        float side = mod(id, 2.0) < 0.5 ? -1.0 : 1.0;
        float back = step(1.5, id);
        float phase = id * 1.73;
        float arch = sin(t * 3.14159);
        float angle = t * 6.8 - uTime * 0.52 + phase;
        float height = mix(1.22, 0.96, back);
        float spread = mix(1.15, 0.87, back);
        vec3 center = vec3(
            side * (0.025 + t * spread + sin(angle) * arch * 0.30),
            -0.085 + t * height,
            0.32 - t * 0.17 - back * 0.15 + cos(angle * 0.72) * arch * 0.08);
        float dx = side * (spread + 0.30 * (6.8 * cos(angle) * arch
            + sin(angle) * 3.14159 * cos(t * 3.14159)));
        vec3 across = normalize(vec3(-height, dx, 0.10 * sin(angle)));
        float width = (0.065 + arch * 0.026) * (1.0 - smoothstep(0.72, 1.0, t));
        width *= mix(1.0, 0.78, back);
        vec3 p = center + across * aSide * width;
        vT = t;
        vSide = aSide;
        vNoise = sin(t * 26.0 - uTime * 1.2 + phase) * 0.70;
        vRibbonStrength = mix(1.0, 0.57, back);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
`;

/** Reuses Psychic's additive core/halo on open arcs, clipped against the host depth. */
export function createGhostRibbonMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        defines: { GHOST_RIBBON: 1 },
        uniforms: {
            uColor: { value: new THREE.Color(0x9b4dee).convertLinearToSRGB() },
            uTime: { value: 0 }, uOpacity: { value: 0 }, uReveal: { value: 0 },
            uPhase: { value: 0 }, uKind: { value: 0 },
            uSceneDepth: { value: null }, uResolution: { value: new THREE.Vector2() },
        },
        vertexShader, fragmentShader: ribbonFragment,
        transparent: true, blending: THREE.AdditiveBlending,
        depthTest: true, depthWrite: false, side: THREE.DoubleSide,
        forceSinglePass: true, toneMapped: false,
    });
}
