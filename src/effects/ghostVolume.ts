/** Smoke condensations sampled in the shared Fighting volume; light ribbons are meshes. */
export const ghostVolumeGLSL = /* glsl */ `
    #ifdef GHOST_SMOKE
    uniform float uGhostTime;
    uniform vec3 uGhostBase, uGhostMid, uGhostEdge;

    float ghostMatter(vec3 p) {
        // Advect structure upwards, independently of the slower curve deformation.
        p.y -= uGhostTime * 0.58;
        p.x += sin(p.y * 5.0 + p.z * 4.0 + uGhostTime * 0.3) * 0.10;
        float folds = sin(p.x * 24.0 + sin(p.y * 12.0)) * sin(p.y * 15.0 - p.z * 19.0);
        float fine = sin(p.x * 47.0 + p.y * 28.0) * sin(p.z * 36.0 - p.y * 21.0);
        return 0.16 + 0.84 * smoothstep(-0.60, 0.74, folds + fine * 0.35);
    }

    float ghostFlowLight(float progress, float phase) {
        // Broad light packets travel towards the tips; there is no frame-wise flicker.
        float wave = 0.5 + 0.5 * sin(progress * 9.0 - uGhostTime * 2.1 + phase);
        return pow(wave, 6.0);
    }

    // Density, dark eyes, rim-weighted density and flow-light-weighted density.
    vec4 ghostBody(vec3 p, float secondary) {
        float birth = mix(0.60, 0.82, secondary);
        float age = max(0.0, uGhostTime - birth);
        float appear = smoothstep(birth, birth + 0.40, uGhostTime);
        float dissolve = 1.0 - smoothstep(1.38, 1.98, uGhostTime);
        float strength = appear * dissolve * mix(1.0, 0.30, secondary);
        if (strength < 0.001) return vec4(0.0);

        float scale = mix(1.0, 0.64, secondary);
        vec3 head = vec3(mix(0.025, 0.47, secondary)
                + sin(age * 1.25 + secondary * 2.3) * age * 0.13,
            mix(0.25, 0.68, secondary) + age * mix(0.34, 0.20, secondary),
            mix(0.40, 0.10, secondary));
        vec3 face = (p - head) / scale;
        float tilt = 0.16 + sin(age * 1.25 + secondary * 2.0) * 0.18;
        face.xy = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * face.xy;
        vec3 q = face;
        // The lower head narrows and bends into the tail, rather than ending in a neck.
        float lower = clamp(-q.y / 0.26, 0.0, 1.0);
        q.x += lower * lower * 0.07;
        vec3 headRadius = vec3(0.185 * (1.0 - lower * 0.32), 0.245, 0.148);
        float headDistance = (length(q / headRadius) - 1.0) * 0.148 * scale;

        float height = max(0.2, head.y + 0.12);
        float t = (p.y + 0.12) / height;
        float tc = clamp(t, 0.0, 1.0);
        float arch = sin(tc * 3.14159);
        float lag = 1.0 - tc;
        vec2 center = mix(vec2(0.0, 0.28), head.xz, tc);
        center.x += (-0.16 + sin(tc * 6.0 - uGhostTime * 1.4 + secondary * 1.8) * 0.055)
            * arch * mix(1.0, 0.75, secondary);
        center.y += sin(tc * 5.0 - uGhostTime * 1.1) * lag * tc * 0.14;
        float radius = mix(0.026, 0.142 * scale, pow(tc, 0.9));
        vec2 delta = (p.xz - center) / vec2(radius, radius * 0.82);
        float tailDistance = (length(delta) - 1.0) * radius;
        tailDistance = max(tailDistance, max(-t, t - 1.04) * height);

        // Smooth signed-distance union removes the old max-density join.
        float blend = clamp(0.5 + 0.5 * (tailDistance - headDistance) / 0.075, 0.0, 1.0);
        float distanceToBody = mix(tailDistance, headDistance, blend) - 0.075 * blend * (1.0 - blend);
        float density = (1.0 - smoothstep(-0.025, 0.038, distanceToBody)) * strength * 2.8;
        density *= smoothstep(-0.04, 0.11, t)
            * mix(0.40 + ghostMatter(p) * 0.70, 1.0, blend);

        // Eyes retain the undeformed facial frame used to orient the upper head.
        float eyeX = (abs(face.x) - 0.068) / 0.029;
        float eyeY = (face.y - 0.025) / 0.050;
        float eyes = (1.0 - smoothstep(0.60, 1.12, length(vec2(eyeX, eyeY))))
            * smoothstep(0.075, 0.108, face.z) * (1.0 - smoothstep(0.148, 0.18, face.z));
        eyes *= smoothstep(birth + 0.16, birth + 0.42, uGhostTime) * dissolve
            * mix(1.0, 0.40, secondary);

        vec3 headNormal = normalize(q / (headRadius * headRadius) + vec3(0.0001));
        float headRim = pow(1.0 - abs(headNormal.z), 2.0);
        float tailRim = exp(-pow((length(delta) - 0.8) * 2.1, 2.0));
        float rim = mix(tailRim * 0.65, headRim, blend);
        float flow = ghostFlowLight(tc, secondary * 1.73) * (1.0 - blend * 0.88);
        return vec4(density, eyes, density * rim, density * flow);
    }
    #endif
`;
