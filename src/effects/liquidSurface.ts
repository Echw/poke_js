import * as THREE from 'three';

/** Radial subdivisions supply real vertices for local ripples and raised crests. */
export function createPoolGeometry(mobile: boolean): THREE.BufferGeometry {
    const rings = mobile ? 20 : 32;
    const segments = mobile ? 48 : 72;
    const positions: number[] = [0, 0, 0];
    const indices: number[] = [];
    for (let ring = 1; ring <= rings; ring++) {
        for (let segment = 0; segment <= segments; segment++) {
            const angle = segment / segments * Math.PI * 2;
            const radius = ring / rings * 0.88;
            positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        }
    }
    for (let segment = 0; segment < segments; segment++) indices.push(0, segment + 2, segment + 1);
    for (let ring = 1; ring < rings; ring++) {
        const inner = 1 + (ring - 1) * (segments + 1);
        const outer = inner + segments + 1;
        for (let segment = 0; segment < segments; segment++) {
            const a = inner + segment, b = outer + segment;
            indices.push(a, b + 1, b, a, a + 1, b + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.94);
    return geometry;
}


/** Environment reflection in world space; shared without changing Water output. */
export const liquidReflectionGLSL = /* glsl */ `
        vec3 reflected = reflect(-view, normalWorld);
        vec2 envUv = vec2(atan(reflected.z, reflected.x) * 0.159154943 + 0.5,
            asin(clamp(reflected.y, -1.0, 1.0)) * 0.318309886 + 0.5);
        vec3 environment = texture2D(uEnvironment, envUv).rgb;
        // Compress the sky's broad hot spots; compact moving glints carry the whites.
        environment /= 1.0 + environment * 0.65;
`;

/** Card-space opacity mask follows the shared illustration handoff. */
export const liquidCardMaskGLSL = /* glsl */ `
        vec2 cardQ = abs(vCardPosition.xy) - vec2(0.31, 0.46);
        float cardDistance = length(max(cardQ, 0.0)) + min(max(cardQ.x, cardQ.y), 0.0) - 0.04;
        float cardMask = 1.0 - smoothstep(-0.012, 0.018, cardDistance);
        alpha *= 1.0 - cardMask * uCardImage;
`;
