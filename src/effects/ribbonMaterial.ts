/** Psychic's light core and halo; Ghost adds only captured-depth clipping and slower flow. */
export const ribbonFragment = /* glsl */ `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uReveal;
    uniform float uTime;
    uniform float uPhase;
    uniform float uKind;
    varying float vT;
    varying float vSide;
    varying float vNoise;
    #ifdef GHOST_RIBBON
    uniform sampler2D uSceneDepth;
    uniform vec2 uResolution;
    varying float vRibbonStrength;
    #endif

    void main() {
        #ifdef GHOST_RIBBON
        float sceneDepth = texture2D(uSceneDepth, gl_FragCoord.xy / uResolution).r;
        if (gl_FragCoord.z > sceneDepth + 0.00002) discard;
        #endif
        float edge = pow(max(0.0, 1.0 - abs(vSide)), 1.65);
        float hot = pow(max(0.0, 1.0 - abs(vSide) * 3.2), 2.0);
        float flicker = 0.67 + 0.33 * sin(vT * 29.0 - uTime * 3.4 + uPhase) * sin(vT * 13.0 + uTime * 1.3);
        #ifdef GHOST_RIBBON
        flicker = 0.82 + 0.18 * sin(vT * 15.0 - uTime * 2.0 + uPhase);
        #endif
        float shape = uKind < 0.5
            ? smoothstep(0.0, 0.10, vT) * (1.0 - smoothstep(0.86, 1.0, vT))
            : (0.08 + 0.92 * smoothstep(-0.30, 0.50, sin(vT * 31.0 + uPhase + uTime)));
        float reveal = uKind < 0.5
            ? 1.0 - smoothstep(uReveal - 0.10, uReveal + 0.04, vT)
            : uReveal;
        float alpha = edge * shape * flicker * reveal * uOpacity * (0.82 + 0.18 * vNoise);
        #ifdef GHOST_RIBBON
        alpha *= vRibbonStrength;
        #endif
        vec3 color = mix(uColor, vec3(1.0, 0.83, 1.0), hot * 0.78);
        gl_FragColor = vec4(color * 1.18, alpha);
    }
`;
