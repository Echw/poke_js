import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CardTransformation, CARD_REVEAL_TIMING } from './cardTransformation';
import type { PokemonRevealEffect } from './types';

const TIMING = {
    growStart: 0.4, growEnd: 1.0,
    morph: CARD_REVEAL_TIMING.morph, image: CARD_REVEAL_TIMING.image,
    streamEnd: CARD_REVEAL_TIMING.fade, poolEnd: 3.1,
    emissionEnd: 2.45, dropsEnd: 3.35, end: CARD_REVEAL_TIMING.complete,
};

// Shared by attached splash geometry and its released droplet.
const SPLASH = { start: 0.8, stagger: 0.25, duration: 0.45, release: 0.72 };
const FLOW = { frequency: 39, speed: 12 };
const POOL_OFFSET = { y: -0.14, z: 0.05 };
// Independent basin events: low left, upper left, upper right. No card-stage trigger.
const BASIN_SPLASH = {
    starts: [[0.65, 1.55], [0.88, 1.85], [1.10, 1.68]],
    duration: 0.55, release: 0.36,
} as const;

// Sweeps and droplets share this exact surface at current/birth time.
// All positions, tangents and emission velocities are Poké Ball local.
const waterSurface = /* glsl */ `
    const float TAU = 6.283185307;
    const float MORPH_TIME = ${TIMING.morph.toFixed(3)};
    const float IMAGE_TIME = ${TIMING.image.toFixed(3)};
    const float STREAM_END = ${TIMING.streamEnd.toFixed(3)};
    const float POOL_END = ${TIMING.poolEnd.toFixed(3)};

    vec3 safeUnit(vec3 v, vec3 fallback) {
        return dot(v, v) > 1e-20 ? normalize(v) : fallback;
    }
    float growthAt(float time) {
        float x = clamp((time - ${TIMING.growStart.toFixed(3)})
            / ${(TIMING.growEnd - TIMING.growStart).toFixed(3)}, 0.0, 1.0);
        return 0.5 - 0.5 * cos(x * 3.141592654);
    }
    float retreatAt(float time) { return smoothstep(MORPH_TIME, STREAM_END, time); }
    float streamStrength(float time) {
        return smoothstep(0.4, 0.82, time) * (1.0 - smoothstep(IMAGE_TIME, STREAM_END, time));
    }
    float poolStrength(float time) {
        return smoothstep(0.0, 0.4, time) * (1.0 - smoothstep(IMAGE_TIME, POOL_END, time));
    }
    float poolHeight(vec2 p, float time) {
        vec2 source = p - vec2(0.0, 0.28);
        float r = length(source);
        float a = r > 0.0001 ? atan(source.y, source.x) : 0.0;
        float wave = sin(r * 42.0 - time * 11.0 + sin(a * 5.0 - time) * 0.5) * 0.012;
        wave += sin(r * 73.0 - time * 16.0 + sin(a * 3.0)) * 0.004;
        float rim = exp(-pow((length(p) - 0.60) * 18.0, 2.0));
        float angle = length(p) > 0.0001 ? atan(p.y, p.x) : 0.0;
        float crest = pow(max(0.0, sin(angle * 5.0 + time * 2.3)), 8.0);
        wave += rim * crest * 0.065 + exp(-r * r * 55.0) * 0.032;
        return wave * poolStrength(time) * (1.0 - smoothstep(0.72, 0.88, length(p)));
    }
    float lengthAt(float time) { return growthAt(time) * (1.0 - 0.25 * retreatAt(time)); }

    vec2 basinStarts(float part) {
        if (part < 4.5) return vec2(${BASIN_SPLASH.starts[0].join(', ')});
        if (part < 5.5) return vec2(${BASIN_SPLASH.starts[1].join(', ')});
        return vec2(${BASIN_SPLASH.starts[2].map(v => v.toFixed(2)).join(', ')});
    }
    float basinPhase(float part, float time) {
        vec2 starts = basinStarts(part);
        float start = time >= starts.y ? starts.y : starts.x;
        return clamp((time - start) / ${BASIN_SPLASH.duration.toFixed(3)}, 0.0, 1.0);
    }
    // The tail leaves the source as the neck closes. The free fragment stays short.
    vec3 basinCenter(float t, float part, float time) {
        float phase = basinPhase(part, time);
        float age = phase * ${BASIN_SPLASH.duration.toFixed(3)};
        float detach = smoothstep(0.12, 0.28, age);
        float heading = part < 4.5 ? 2.88 : (part < 5.5 ? 3.48 : 0.06);
        vec2 direction = vec2(cos(heading), sin(heading));
        float head = 0.06 + 0.74 * smoothstep(0.0, 0.28, age) + 0.18 * phase;
        float tail = max(0.0, head - 0.33) * detach;
        float reach = mix(tail, head, t);
        vec2 pointXZ = vec2(0.0, 0.30) + direction * reach;
        pointXZ += vec2(-direction.y, direction.x) * sin(t * 3.141592654)
            * sin(phase * 4.0 + part) * 0.035;
        float height = part < 4.5 ? 0.18 : (part < 5.5 ? 0.35 : 0.45);
        float lift = sin(phase * 3.141592654);
        float arc = mix(0.0, 0.72, detach) + (1.0 - 0.72 * detach) * sin(t * 1.570796327);
        // The attached foot follows the pool; once free, the trajectory is smooth.
        float y = ${POOL_OFFSET.y.toFixed(2)} + mix(poolHeight(vec2(0.0, 0.30), time), 0.0, detach);
        y += height * lift * arc;
        return vec3(pointXZ.x, y, pointXZ.y + ${POOL_OFFSET.z.toFixed(2)});
    }
    vec3 basinTangent(float t, float part, float time) {
        return safeUnit(basinCenter(t + 0.002, part, time)
            - basinCenter(t - 0.002, part, time), vec3(0.0, 1.0, 0.0));
    }
    vec3 basinSurface(float t, float theta, float part, float time, float radial) {
        float phase = basinPhase(part, time);
        float age = phase * ${BASIN_SPLASH.duration.toFixed(3)};
        vec3 tangent = basinTangent(t, part, time);
        vec3 across = safeUnit(cross(tangent, vec3(0.0, 0.0, 1.0)), vec3(1.0, 0.0, 0.0));
        vec3 binormal = cross(across, tangent);
        float radius = 0.042 * (0.88 + 0.18 * sin(t * 9.0 - phase * 8.0 + part));
        radius *= pow(max(0.0, sin(t * 3.141592654)), 0.38);
        float neck = exp(-pow((t - 0.18) * 11.0, 2.0));
        radius *= 1.0 - neck * 0.94 * sin(smoothstep(0.12, 0.30, age) * 3.141592654);
        radius *= smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.43, 0.55, age));
        float twist = theta + sin(t * 5.0 - phase * 4.0) * 0.16;
        return basinCenter(t, part, time)
            + (across * cos(twist) + binormal * sin(twist)) * radius * radial;
    }
    vec3 streamCenter(float s, float time) {
        float retreat = retreatAt(time);
        float angle = s * 8.35 - 0.25 + sin(s * 13.0 - time * 1.3) * 0.045;
        float radius = 0.66 * smoothstep(0.0, 0.18, s) * (1.0 - 0.14 * s);
        float envelope = sin(clamp(s, 0.0, 1.0) * 3.141592654);
        vec3 p = vec3(radius * sin(angle), -0.075 + s * 1.15,
            0.38 + radius * cos(angle) * 0.59);
        p.x += envelope * (sin(s * 18.0 - time * 3.1) * 0.034 + sin(s * 9.0 - time) * 0.022);
        p.y += envelope * sin(s * 15.0 - time * 1.4) * 0.022;
        p.x *= 1.0 + retreat * 0.27;
        p.z -= retreat * smoothstep(0.1, 0.5, s) * 0.18;
        return p;
    }
    vec3 streamTangent(float s, float time) {
        return safeUnit(streamCenter(s + 0.002, time) - streamCenter(s - 0.002, time), vec3(0.0, 1.0, 0.0));
    }
    vec3 outwardAt(vec3 center) {
        return safeUnit(vec3(center.x, 0.07, center.z - 0.38), vec3(1.0, 0.0, 0.0));
    }
    // One travelling phase drives volume, highlights and the birth surface.
    float flowPhase(float s, float time) {
        return s * ${FLOW.frequency.toFixed(1)} - time * ${FLOW.speed.toFixed(1)};
    }
    float splashStart(float part) {
        return ${SPLASH.start.toFixed(3)} + (part - 1.0) * ${SPLASH.stagger.toFixed(3)};
    }
    float splashPhase(float part, float time) {
        return clamp((time - splashStart(part)) / ${SPLASH.duration.toFixed(3)}, 0.0, 1.0);
    }
    float splashParameter(float part, float time) {
        float s = part < 1.5 ? 0.20 : (part < 2.5 ? 0.56 : 0.86);
        s += splashPhase(part, time) * 0.045;
        return min(s / max(lengthAt(time), 0.001), 0.98);
    }
    float partParameter(float t, float part, float time) {
        if (part > 3.5) return t * 0.75;
        return part < 0.5 ? t * lengthAt(time) : splashParameter(part, time) * lengthAt(time);
    }
    // Thick rounded lower flow with advected shoulders, rather than a flat ribbon.
    vec3 mainSurface(float t, float theta, float time, float radial) {
        float s = t * lengthAt(time);
        vec3 center = streamCenter(s, time);
        vec3 tangent = streamTangent(s, time);
        vec3 across = safeUnit(cross(tangent, vec3(0.0, 0.0, 1.0)), vec3(1.0, 0.0, 0.0));
        vec3 binormal = cross(across, tangent);
        float q = flowPhase(s, time);
        float packet = pow(0.5 + 0.5 * sin(q), 2.0);
        float radius = mix(0.105, 0.043, smoothstep(0.12, 1.0, s));
        radius *= 0.64 + packet * 0.72 + 0.12 * sin(q * 1.73 + 0.6);
        radius *= mix(0.48, 1.0, smoothstep(0.0, 0.07, s));
        radius *= (1.0 - retreatAt(time) * 0.72) * smoothstep(0.0, 0.12, 1.0 - t);
        // The free tip can neck down; the lower stream stays connected.
        float neck = smoothstep(0.84, 0.98, t) * pow(0.5 + 0.5 * sin(q * 1.4), 8.0);
        radius *= 1.0 - neck * 0.92;
        float twist = theta + 0.30 * sin(q * 0.45);
        float lobes = 1.0 + 0.16 * cos(theta * 2.0 - q * 0.6)
            + 0.11 * sin(theta * 3.0 + q) + 0.075 * cos(theta * 5.0 - q * 1.8);
        return center + (across * cos(twist) + binormal * sin(twist) * 0.88) * radius * lobes * radial;
    }
    vec3 splashDirection(float part, float time) {
        float s = splashParameter(part, time) * lengthAt(time);
        return safeUnit(outwardAt(streamCenter(s, time)) + streamTangent(s, time) * 0.35, vec3(1.0, 0.0, 0.0));
    }
    vec3 splashCenter(float t, float part, float time) {
        float phase = splashPhase(part, time);
        float rootT = splashParameter(part, time);
        float s = rootT * lengthAt(time);
        vec3 root = streamCenter(s, time);
        vec3 tangent = streamTangent(s, time);
        vec3 across = safeUnit(cross(tangent, vec3(0.0, 0.0, 1.0)), vec3(1.0, 0.0, 0.0));
        vec3 binormal = cross(across, tangent);
        vec3 outward = outwardAt(root);
        float theta = atan(dot(outward, binormal) / 0.88, dot(outward, across))
            - 0.30 * sin(flowPhase(s, time) * 0.45);
        // Embed the rounded root in the same shoulder used by the main sweep.
        vec3 origin = mainSurface(rootT, theta, time, 0.82);
        float stretch = smoothstep(0.0, 0.70, phase);
        float extent = mix(0.26, 0.19, (part - 1.0) * 0.5) * stretch;
        vec3 direction = splashDirection(part, time);
        return origin + direction * t * extent
            + vec3(0.0, sin(t * 2.8) * 0.10, 0.0) * stretch
            + tangent * t * t * 0.07 * stretch;
    }
    float partVisibility(float part, float time) {
        if (part > 3.5) {
            float phase = basinPhase(part, time);
            return smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.76, 1.0, phase));
        }
        float strength = streamStrength(time);
        if (part < 0.5) return strength;
        float phase = splashPhase(part, time);
        return strength * smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.76, 1.0, phase))
            * (1.0 - smoothstep(MORPH_TIME, IMAGE_TIME, time));
    }
    vec3 surfacePoint(float t, float theta, float part, float time, float radial) {
        if (part > 3.5) return basinSurface(t, theta, part, time, radial);
        if (part < 0.5) return mainSurface(t, theta, time, radial);
        float phase = splashPhase(part, time);
        vec3 center = splashCenter(t, part, time);
        float stretch = smoothstep(0.0, 0.70, phase);
        float extent = mix(0.26, 0.19, (part - 1.0) * 0.5) * stretch;
        float sourceS = splashParameter(part, time) * lengthAt(time);
        // Exact derivative of the curled centerline avoids two nested surface evaluations.
        vec3 tangent = safeUnit(splashDirection(part, time) * extent
            + vec3(0.0, cos(t * 2.8) * 0.28, 0.0) * stretch
            + streamTangent(sourceS, time) * t * 0.14 * stretch, vec3(0.0, 1.0, 0.0));
        vec3 across = safeUnit(cross(tangent, vec3(0.0, 0.0, 1.0)), vec3(1.0, 0.0, 0.0));
        vec3 binormal = cross(across, tangent);
        float neck = exp(-pow((t - 0.65) * 8.0, 2.0)) * smoothstep(0.48, 0.86, phase);
        float radius = mix(0.065, 0.040, (part - 1.0) * 0.5)
            * (0.8 + 0.30 * sin(t * 4.0)) * sqrt(max(0.0, 1.0 - t * t));
        radius *= smoothstep(0.0, 0.18, phase) * (1.0 - neck * 0.96);
        radius *= 1.0 - smoothstep(0.78, 1.0, phase);
        return center + (across * cos(theta) + binormal * sin(theta) * 0.82) * radius * radial;
    }
`;

const surfaceVaryings = /* glsl */ `
    varying vec3 vViewNormal;
    varying vec3 vViewTangent;
    varying vec3 vWorldPosition;
    varying vec3 vCardPosition;
    varying vec2 vSurface;
    varying float vVisibility;
    varying float vThickness;
    varying float vBasin;
`;

const streamVertex = /* glsl */ `
    uniform float uTime;
    uniform mat4 uWorldToCard;
    attribute float aPart;
    ${surfaceVaryings}
    ${waterSurface}
    void main() {
        vVisibility = partVisibility(aPart, uTime);
        if (vVisibility < 0.004) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
        }
        float t = position.y + 0.5;
        float radial = length(position.xz);
        float theta = radial > 0.001 ? atan(position.z, position.x) : 0.0;
        vec3 pos = surfacePoint(t, theta, aPart, uTime, radial);
        // Differentiate the complete sweep, including lobes, bulges and taper.
        // Sample inside the pole so the normal never uses a zero-area tip.
        float sampleT = clamp(t, 0.003, 0.997);
        vec3 surface = (t == sampleT && radial > 0.99)
            ? pos : surfacePoint(sampleT, theta, aPart, uTime, 1.0);
        vec3 along = surfacePoint(sampleT + 0.001, theta, aPart, uTime, 1.0) - surface;
        vec3 around = surfacePoint(sampleT, theta + 0.008, aPart, uTime, 1.0) - surface;
        vec3 tangent = safeUnit(along, vec3(0.0, 1.0, 0.0));
        vec3 n = safeUnit(cross(along, around), vec3(1.0, 0.0, 0.0));
        if (abs(normal.y) > 0.5) n = tangent * normal.y;
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vViewNormal = normalize(normalMatrix * n);
        vViewTangent = normalize(mat3(modelViewMatrix) * tangent);
        vWorldPosition = world.xyz;
        vCardPosition = (uWorldToCard * world).xyz;
        vSurface = vec2(partParameter(t, aPart, uTime), theta);
        vThickness = clamp(length(around) / 0.004, 0.008, 0.24);
        vBasin = aPart > 3.5 ? 1.0 : 0.0;
        float breakup = smoothstep(0.35, 0.95, retreatAt(uTime)) * smoothstep(0.45, 0.95, t)
            * smoothstep(0.3, 0.8, sin(t * 64.0 - uTime * 9.0));
        if (aPart < 3.5) vVisibility *= 1.0 - breakup;

        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

const poolVertex = /* glsl */ `
    uniform float uTime;
    uniform mat4 uWorldToCard;
    ${surfaceVaryings}
    ${waterSurface}
    void main() {
        vec2 p = position.xz;
        vec3 pos = position + vec3(0.0, poolHeight(p, uTime), 0.0);
        float dx = (poolHeight(p + vec2(0.002, 0.0), uTime) - poolHeight(p - vec2(0.002, 0.0), uTime)) / 0.004;
        float dz = (poolHeight(p + vec2(0.0, 0.002), uTime) - poolHeight(p - vec2(0.0, 0.002), uTime)) / 0.004;
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vViewNormal = normalize(normalMatrix * vec3(-dx, 1.0, -dz));
        vViewTangent = normalize(mat3(modelViewMatrix) * vec3(1.0, dx, 0.0));
        vWorldPosition = world.xyz;
        vCardPosition = (uWorldToCard * world).xyz;
        vec2 source = p - vec2(0.0, 0.28);
        vSurface = vec2(length(source), length(source) > 0.0001 ? atan(source.y, source.x) : 0.0);
        vThickness = 0.06;
        vBasin = 0.0;
        vVisibility = poolStrength(uTime) * (1.0 - smoothstep(0.76, 0.88, length(p)));
        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

const surfaceFragment = /* glsl */ `
    uniform sampler2D uEnvironment;
    uniform float uTime;
    uniform float uCardImage;
    ${surfaceVaryings}
    void main() {
        if (vVisibility < 0.004) discard;
        vec3 n = normalize(vViewNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 tangent = vViewTangent - n * dot(n, vViewTangent);
        tangent = normalize(tangent + vec3(0.00001));
        vec3 bitangent = normalize(cross(n, tangent));
        float q = vSurface.x * ${FLOW.frequency.toFixed(1)} - uTime * ${FLOW.speed.toFixed(1)};
        #ifdef POOL
        q = vSurface.x * 75.0 - uTime * 22.0;
        #endif
        #ifdef POOL
        n = normalize(n + tangent * cos(q + sin(vSurface.y * 3.0)) * 0.22
            + bitangent * sin(q * 0.63 - vSurface.y * 4.0) * 0.16);
        #elif !defined(DROP)
        float detailStrength = vBasin > 0.5 ? 0.25 : 1.0;
        n = normalize(n + tangent * cos(q * 3.7 + sin(vSurface.y * 5.0)) * 0.22 * detailStrength
            + bitangent * sin(q * 2.8 - vSurface.y * 5.0) * 0.17 * detailStrength);
        #endif
        vec3 normalWorld = normalize(vec3(dot(viewMatrix[0].xyz, n),
            dot(viewMatrix[1].xyz, n), dot(viewMatrix[2].xyz, n)));
        vec3 view = normalize(cameraPosition - vWorldPosition);
        float facing = clamp(dot(normalWorld, view), 0.0, 1.0);
        float rim = pow(1.0 - facing, 3.5);
        float fresnel = 0.0204 + 0.9796 * pow(1.0 - facing, 5.0);
        vec3 reflected = reflect(-view, normalWorld);
        vec2 envUv = vec2(atan(reflected.z, reflected.x) * 0.159154943 + 0.5,
            asin(clamp(reflected.y, -1.0, 1.0)) * 0.318309886 + 0.5);
        vec3 environment = texture2D(uEnvironment, envUv).rgb;
        // Compress the sky's broad hot spots; compact moving glints carry the whites.
        environment /= 1.0 + environment * 0.65;
        vec3 key = normalize(vec3(-0.65, 0.95, 1.25));
        vec3 side = normalize(vec3(0.85, 0.35, 1.0));
        float broad = pow(max(dot(reflected, key), 0.0), 24.0);
        float glint = pow(max(dot(normalWorld, normalize(view + key)), 0.0), 110.0)
            + 0.65 * pow(max(dot(normalWorld, normalize(view + side)), 0.0), 170.0);
        float churn = 0.55 + 0.45 * sin(q * 0.52 + sin(vSurface.y * 3.0));
        float highlights = 0.18 + 0.82 * pow(0.5 + 0.5 * sin(q * 0.71 + vSurface.y * 2.0), 3.0);
        float ridges = pow(max(0.0, sin(vSurface.y * 5.0 + q * 0.34 + sin(q * 0.73))), 12.0);
        vec3 color = vec3(0.008, 0.10, 0.32) + environment * vec3(0.3, 0.65, 1.0) * (0.06 + fresnel * 0.32);
        #ifdef POOL
        float broadStrength = 0.75;
        #else
        float broadStrength = 0.35;
        #endif
        color += vec3(0.015, 0.42, 1.0) * (broad * broadStrength + rim * (0.8 + churn * 1.3));
        color += vec3(0.03, 0.55, 1.4) * ridges * (0.25 + rim) * churn;
        color += vec3(0.65, 0.92, 1.0) * glint * highlights * 4.0;
        #if !defined(POOL) && !defined(DROP)
        // Local diameter estimates optical depth without a transmission pass.
        float opticalDepth = vThickness / max(facing, 0.35);
        vec3 transmission = exp(-vec3(8.0, 3.0, 0.8) * opticalDepth);
        color *= mix(vec3(0.52, 0.72, 0.86), vec3(1.0), transmission);
        color += vec3(0.08, 0.36, 0.55) * pow(rim, 0.65) * highlights;
        float thin = 1.0 - smoothstep(0.035, 0.15, vThickness);
        color += vec3(0.025, 0.28, 0.48) * thin * (0.3 + rim);
        #endif
        float alpha = mix(0.86, 0.98, fresnel) * vVisibility;
        #ifdef POOL
        float crest = pow(max(0.0, sin(vSurface.x * 42.0 - uTime * 11.0
            + sin(vSurface.y * 5.0 - uTime) * 0.5)), 12.0);
        crest *= 0.4 + 0.6 * pow(0.5 + 0.5 * sin(vSurface.y * 7.0 + q * 0.3), 2.0);
        color += vec3(0.003, 0.045, 0.13) + vec3(0.08, 0.85, 2.3) * crest;
        alpha *= 0.88;
        #endif
        #ifdef DROP
        // Filled liquid body with a compact highlight, rather than a bubble rim.
        color = vec3(0.008, 0.10, 0.32) * (0.6 + max(dot(normalWorld, side), 0.0))
            + environment * 0.18 + vec3(0.03, 0.35, 0.8) * (broad + rim * 0.24)
            + vec3(0.75, 0.95, 1.0) * glint * 4.5;
        alpha = 0.95 * vVisibility;
        #endif
        // Ball occlusion uses actual depth; the card mask handles its opacity tween.
        vec2 cardQ = abs(vCardPosition.xy) - vec2(0.31, 0.46);
        float cardDistance = length(max(cardQ, 0.0)) + min(max(cardQ.x, cardQ.y), 0.0) - 0.04;
        float cardMask = 1.0 - smoothstep(-0.012, 0.018, cardDistance);
        alpha *= 1.0 - cardMask * uCardImage;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const dropVertex = /* glsl */ `
    uniform float uTime;
    uniform mat4 uWorldToCard;
    attribute vec4 aEvent;
    attribute vec4 aSeed;
    ${surfaceVaryings}
    ${waterSurface}
    void main() {
        float part = aEvent.z;
        float birth = aEvent.x;
        if (part > 3.5) {
            vec2 starts = basinStarts(part);
            birth += uTime >= starts.y + aEvent.x ? starts.y : starts.x;
        }
        float age = max(0.0, uTime - birth);
        float life = aEvent.y;
        // Dormant pool slots do not evaluate the moving birth surface.
        if (uTime < birth || age >= life) {
            vVisibility = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
        }
        float eventSeed = aSeed.w;
        float s = mix(0.12, 0.96, eventSeed);
        float t = min(s / max(lengthAt(birth), 0.001), 0.97);
        float theta = aSeed.y * TAU;
        vec3 origin;
        vec3 velocity;
        if (part > 3.5) {
            float lip = 0.80 + aEvent.w * 0.16;
            origin = basinSurface(lip, theta, part, birth, 1.0);
            vec3 carried = (basinSurface(lip, theta, part, birth + 0.004, 1.0)
                - basinSurface(lip, theta, part, birth - 0.004, 1.0)) / 0.008;
            velocity = carried * 0.32 + basinTangent(lip, part, birth) * 0.20
                + vec3(aSeed.y - 0.5, aSeed.z, aSeed.x - 0.5) * 0.08;
            s = lip * 0.75;
        } else if (part > 0.5) {
            float lip = 0.80 + aEvent.w * 0.18;
            origin = surfacePoint(lip, theta, part, birth, 1.0);
            vec3 carried = (splashCenter(lip, part, birth + 0.008)
                - splashCenter(lip, part, birth - 0.008)) / 0.016;
            float sourceS = splashParameter(part, birth) * lengthAt(birth);
            velocity = carried * 0.50 + splashDirection(part, birth) * 0.34
                + streamTangent(sourceS, birth) * 0.25;
            velocity += vec3(aSeed.y - 0.5, aSeed.z - 0.35, aSeed.x - 0.5) * 0.90;
            s = sourceS;
        } else {
            origin = mainSurface(t, theta, birth, 1.0);
            velocity = streamTangent(t * lengthAt(birth), birth) * 0.52
                + outwardAt(origin) * (0.20 + aSeed.z * 0.20);
        }
        vec3 center = origin + velocity * age - vec3(0.0, 0.90 * age * age, 0.0);
        velocity.y -= 1.8 * age;
        vec3 axis = safeUnit(velocity, vec3(0.0, 1.0, 0.0));
        vec3 reference = abs(axis.z) < 0.95 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        vec3 across = normalize(cross(axis, reference));
        vec3 binormal = cross(across, axis);
        float stretch = 1.0 + min(length(velocity), 1.8) * 0.38;
        float size = 0.012 + aSeed.x * aSeed.x * 0.024;
        vec3 pos = center + (across * position.x + binormal * position.z + axis * position.y * stretch) * size;
        vec3 n = normalize(across * normal.x + binormal * normal.z + axis * normal.y / stretch);
        vec4 world = modelMatrix * vec4(pos, 1.0);
        vViewNormal = normalize(normalMatrix * n);
        vViewTangent = normalize(mat3(modelViewMatrix) * axis);
        vWorldPosition = world.xyz;
        vCardPosition = (uWorldToCard * world).xyz;
        vSurface = vec2(s, theta);
        vThickness = size * 2.0;
        vBasin = 0.0;
        vVisibility = step(birth, uTime)
            * (1.0 - smoothstep(life * 0.65, life, age));
        if (part < 3.5) vVisibility *= 1.0 - smoothstep(MORPH_TIME, IMAGE_TIME + 0.4, birth) * 0.72;
        vVisibility *= (1.0 - smoothstep(2.9, ${TIMING.dropsEnd.toFixed(3)}, uTime));
        if (part > 0.5) vVisibility *= smoothstep(0.0, 0.025, age);
        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

// Grass's two outer routes, in Ball-local space; the water occupies its central route.
const glowRibbonVertex = /* glsl */ `
    uniform float uTime;
    uniform float uMobile;
    uniform mat4 uWorldToCard;
    attribute float aT;
    attribute float aSide;
    attribute float aRibbon;
    attribute float aStrand;
    varying vec4 vRibbonData;
    varying vec2 vLocal;
    varying vec3 vCardPosition;
    varying float vVisibility;
    void main() {
        float t = aT;
        float angle;
        float radius;
        float height;
        float width;
        if (aRibbon < 1.5) {
            angle = t * 10.8 + uTime * 0.38 - 1.8 + 0.14 * sin(t * 15.0 - uTime);
            radius = (mix(0.22, 1.05, smoothstep(0.02, 0.34, t))
                * (0.95 + 0.05 * sin(t * 17.0 - uTime * 0.7))) * mix(1.0, 0.84, uMobile);
            height = -0.09 + t * 0.32 + 0.11 * sin(t * 9.0 + uTime * 0.7);
            width = 0.09 + 0.055 * sin(t * 3.14159);
        } else {
            angle = t * 12.4 - uTime * 0.48 + 0.9 + 0.17 * sin(t * 16.0 + uTime);
            radius = mix(0.16, 0.78, smoothstep(0.03, 0.67, t))
                * (0.92 + 0.08 * sin(t * 17.0 + uTime * 0.45));
            height = 0.01 + t * 1.20 + 0.12 * sin(t * 9.0 - uTime * 0.6);
            width = 0.075 + 0.055 * sin(t * 3.14159);
        }
        angle += aStrand * (aRibbon < 1.5 ? 0.56 : -0.53);
        radius *= 1.0 + aStrand * 0.055;
        height += aStrand * 0.050;
        height += aRibbon < 1.5 ? 0.22 * sin(angle + 0.30) : 0.11 * sin(angle - 0.45);
        float endWidth = smoothstep(0.0, 0.16, t) * (1.0 - smoothstep(0.78, 1.0, t));
        width *= (aStrand < 0.5 ? 1.0 : 0.72) * 1.35 * endWidth;
        vec3 center = vec3(radius * cos(angle), height, 0.50 + radius * sin(angle) * 0.38);
        vec3 across = normalize(vec3(0.48 * cos(angle), 0.78 + 0.12 * sin(angle * 1.6), 0.10 * sin(angle)));
        vec3 point = center + across * aSide * width;
        vec4 world = modelMatrix * vec4(point, 1.0);
        vCardPosition = (uWorldToCard * world).xyz;
        vRibbonData = vec4(t, aSide, aRibbon, aStrand);
        vLocal = vec2(point.x, center.z);
        float front = smoothstep(0.38, 0.65, center.z);
        float frontFade = 1.0 - smoothstep(${TIMING.morph.toFixed(3)}, 2.35, uTime);
        float backFade = 1.0 - smoothstep(${TIMING.image.toFixed(3)}, ${TIMING.poolEnd.toFixed(3)}, uTime);
        vVisibility = smoothstep(0.4, 1.0, uTime) * mix(backFade, frontFade, front);
        gl_Position = projectionMatrix * viewMatrix * world;
    }
`;

const glowRibbonFragment = /* glsl */ `
    uniform float uTime;
    uniform float uCardImage;
    uniform float uMorph;
    uniform vec3 uBlue;
    uniform vec3 uCyan;
    uniform vec3 uHot;
    varying vec4 vRibbonData;
    varying vec2 vLocal;
    varying vec3 vCardPosition;
    varying float vVisibility;
    void main() {
        float t = vRibbonData.x;
        float side = vRibbonData.y;
        float route = vRibbonData.z;
        float strand = vRibbonData.w;
        float soft = pow(max(0.0, 1.0 - abs(side)), 2.45);
        float center = pow(max(0.0, 1.0 - abs(side) * 3.4), 2.0);
        float taper = smoothstep(0.0, route > 1.5 ? 0.23 : 0.11, t)
            * (1.0 - smoothstep(0.84, 1.0, t));
        float wave = sin(t * 27.0 - uTime * 2.3 + route * 2.5)
            + 0.45 * sin(t * 13.0 + uTime * 1.1 - route);
        float flow = 0.20 + 0.80 * smoothstep(-0.55, 0.72, wave);
        float depth = mix(0.50, 1.0, smoothstep(-0.35, 0.92, vLocal.y));
        float activity = route < 1.5 ? 1.0 : 1.0 - uMorph * 0.20;
        float alpha = (soft * 0.045 + center * 0.76) * taper * flow * depth
            * vVisibility * activity * (strand < 0.5 ? 0.90 : 0.50);
        alpha *= 1.0 - smoothstep(1.05, 1.47, abs(vLocal.x));
        // Preserve Water's exact card-space mask as the illustration becomes opaque.
        vec2 cardQ = abs(vCardPosition.xy) - vec2(0.31, 0.46);
        float cardDistance = length(max(cardQ, 0.0)) + min(max(cardQ.x, cardQ.y), 0.0) - 0.04;
        alpha *= 1.0 - (1.0 - smoothstep(-0.012, 0.018, cardDistance)) * uCardImage;
        if (alpha < 0.002) discard;
        vec3 color = mix(uBlue, uCyan, soft * 0.82);
        color = mix(color, uHot, center * 0.85);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

/** Two Grass-inspired outer routes, each with independently offset strands. */
function createGlowRibbonGeometry(mobile: boolean): THREE.BufferGeometry {
    const segments = mobile ? 64 : 96;
    const across = 4;
    const strands = mobile ? 2 : 3;
    const verticesPerRibbon = (segments + 1) * (across + 1);
    const count = 2 * strands * verticesPerRibbon;
    const positions = new Float32Array(count * 3);
    const times = new Float32Array(count);
    const sides = new Float32Array(count);
    const routes = new Float32Array(count);
    const strandIds = new Float32Array(count);
    const indices: number[] = [];
    for (let band = 0; band < 2 * strands; band++) {
        for (let segment = 0; segment <= segments; segment++) {
            for (let side = 0; side <= across; side++) {
                const index = band * verticesPerRibbon + segment * (across + 1) + side;
                times[index] = segment / segments;
                sides[index] = side / across * 2 - 1;
                routes[index] = 1 + Math.floor(band / strands);
                strandIds[index] = band % strands;
                if (segment < segments && side < across) {
                    const next = index + across + 1;
                    indices.push(index, next, index + 1, index + 1, next, next + 1);
                }
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aT', new THREE.BufferAttribute(times, 1));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    geometry.setAttribute('aRibbon', new THREE.BufferAttribute(routes, 1));
    geometry.setAttribute('aStrand', new THREE.BufferAttribute(strandIds, 1));
    geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0.50), 2.0);
    return geometry;
}

function createStreamGeometry(mobile: boolean): THREE.BufferGeometry {
    const layers: THREE.BufferGeometry[] = [];
    // 0: core, 1–3: existing stream splashes, 4–6: independent basin routes.
    const parts = mobile ? [0, 1, 3, 4, 6] : [0, 1, 2, 3, 4, 5, 6];
    for (const part of parts) {
        const radial = part === 0 ? (mobile ? 12 : 16) : (part >= 4 && mobile ? 6 : 8);
        const length = part === 0 ? (mobile ? 80 : 128) : (part >= 4 && mobile ? 12 : 16);
        // Basin sweeps close at zero-radius poles, so no planar cap fans are needed.
        const geometry = new THREE.CylinderGeometry(1, 1, 1, radial, length, part >= 4);
        geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(
            new Float32Array(geometry.getAttribute('position').count).fill(part), 1));
        layers.push(geometry);
    }
    const geometry = mergeGeometries(layers);
    layers.forEach((layer) => layer.dispose());
    if (!geometry) throw new Error('Water stream geometry unavailable');
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0.38), 1.9);
    return geometry;
}

/** Radial subdivisions supply real vertices for local ripples and raised crests. */
function createPoolGeometry(mobile: boolean): THREE.BufferGeometry {
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

function createDropGeometry(mobile: boolean): THREE.InstancedBufferGeometry {
    const sphere = new THREE.SphereGeometry(1, mobile ? 8 : 12, mobile ? 6 : 8);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(sphere.index);
    for (const [name, attribute] of Object.entries(sphere.attributes)) geometry.setAttribute(name, attribute);
    sphere.dispose();
    const count = mobile ? 16 : 32;
    const events = new Float32Array(count * 4);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const seed = (i * 0.61803398875) % 1;
        const perSplash = mobile ? 6 : 8;
        const groupCount = mobile ? 2 : 3;
        const group = Math.floor(i / perSplash);
        let part = group < groupCount ? 1 + group * (mobile ? 2 : 1) : 0;
        let within = (i % perSplash) / (perSplash - 1);
        let life = 0.60 + seed * 0.22;
        let birth = SPLASH.start + (part - 1) * SPLASH.stagger + SPLASH.duration * SPLASH.release
            + (within - 0.5) * 0.13;
        if (part === 0) {
            const spare = i - groupCount * perSplash;
            const basinSlots = mobile ? 3 : 6;
            if (spare < basinSlots) {
                part = mobile ? (spare === 0 ? 4 : 6) : 4 + Math.floor(spare / 2);
                within = spare % 2 === 0 ? 0.25 : 0.75;
                // The shader selects the route's first/second birth; both reuse this slot.
                birth = BASIN_SPLASH.release + (within - 0.5) * 0.04;
                life = 0.48;
            } else {
                birth = spare === basinSlots ? 0.18 : TIMING.emissionEnd;
            }
        }
        events.set([birth, life, part, within], i * 4);
        seeds.set([0.14 + ((i * 0.754877666) % 1) * 0.86,
            (i * 0.414213562) % 1, (i * 0.569840296) % 1, seed], i * 4);
    }
    geometry.setAttribute('aEvent', new THREE.InstancedBufferAttribute(events, 4));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geometry.instanceCount = count;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0.38), 2.2);
    return geometry;
}

/** Sweeps, surface-born splashes and droplets on the host's single timeline. */
export class WaterEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0x138dff);
    readonly fillLightPosition = new THREE.Vector3(0, 0.02, 0.38);
    readonly transformation: CardTransformation;
    private readonly state = { tail: 0 };
    private readonly stream: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly pool: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly drops: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
    private readonly glow: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly worldToCard = new THREE.Matrix4();
    private finished = false;
    private disposed = false;

    constructor(card: THREE.Mesh, environment: THREE.Texture, mobile = false) {
        this.root.name = 'WaterEffect';
        this.transformation = new CardTransformation(card, 'water', mobile);
        this.root.add(this.transformation.root);
        const uniforms = {
            uEnvironment: { value: environment }, uWorldToCard: { value: this.worldToCard },
            uTime: { value: 0 }, uCardImage: { value: 0 },
        };
        const material = new THREE.ShaderMaterial({
            uniforms, vertexShader: streamVertex, fragmentShader: surfaceFragment,
            transparent: true, blending: THREE.NormalBlending,
            depthTest: true, depthWrite: false, side: THREE.FrontSide,
        });
        this.stream = new THREE.Mesh(createStreamGeometry(mobile), material);
        this.stream.name = 'WaterStream';
        this.stream.renderOrder = 3.1;
        this.root.add(this.stream);

        const poolMaterial = new THREE.ShaderMaterial({
            uniforms, defines: { POOL: 1 }, vertexShader: poolVertex, fragmentShader: surfaceFragment,
            transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
        });
        this.pool = new THREE.Mesh(createPoolGeometry(mobile), poolMaterial);
        this.pool.name = 'WaterPool';
        this.pool.position.set(0, POOL_OFFSET.y, POOL_OFFSET.z);
        this.pool.renderOrder = 2;
        this.root.add(this.pool);

        const dropMaterial = new THREE.ShaderMaterial({
            uniforms, defines: { DROP: 1 }, vertexShader: dropVertex, fragmentShader: surfaceFragment,
            transparent: true, depthTest: true, depthWrite: false, side: THREE.FrontSide,
        });
        this.drops = new THREE.Mesh(createDropGeometry(mobile), dropMaterial);
        this.drops.name = 'WaterDrops';
        this.drops.renderOrder = 3.2;
        this.root.add(this.drops);
        const glowMaterial = new THREE.ShaderMaterial({
            uniforms: {
                ...uniforms, uMobile: { value: mobile ? 1 : 0 }, uMorph: { value: 0 },
                uBlue: { value: new THREE.Color(0x248bff) },
                uCyan: { value: new THREE.Color(0x7beaff) },
                uHot: { value: new THREE.Color(0xeeffff) },
            },
            vertexShader: glowRibbonVertex, fragmentShader: glowRibbonFragment,
            toneMapped: false,
            transparent: true, blending: THREE.AdditiveBlending,
            depthTest: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
        });
        this.glow = new THREE.Mesh(createGlowRibbonGeometry(mobile), glowMaterial);
        this.glow.name = 'WaterGlowRibbons';
        this.glow.renderOrder = 3.15;
        this.root.add(this.glow);
        this.stream.onBeforeRender = this.pool.onBeforeRender = this.drops.onBeforeRender = this.glow.onBeforeRender = () => {
            card.updateWorldMatrix(true, false);
            this.worldToCard.copy(card.matrixWorld).invert();
        };
        this.root.visible = false;
    }

    get fillLightIntensity(): number {
        if (this.finished) return 0;
        const shared = this.transformation.state;
        return (shared.core * 1.1 + shared.energy * 1.6)
            * (1 - shared.morph * 0.72) * (1 - shared.cardImage) * shared.fade;
    }

    setActive(active: boolean): void {
        if (this.disposed) return;
        this.root.visible = active;
        this.transformation.setActive(active);
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        // Surface envelopes use timeline time in GLSL; this tween owns the tail duration.
        timeline.to(this.state, { tail: 1, duration: TIMING.end - TIMING.image, ease: 'none' }, TIMING.image);
    }

    update(time: number, _viewportHeight: number): void {
        if (this.disposed) return;
        this.transformation.update(time);
        this.stream.material.uniforms.uTime.value = time;
        this.stream.material.uniforms.uCardImage.value = this.transformation.state.cardImage;
        this.glow.material.uniforms.uMorph.value = this.transformation.state.morph;
        this.stream.visible = !this.finished && time > TIMING.growStart && time < TIMING.streamEnd;
        this.pool.visible = !this.finished && time > 0 && time < TIMING.poolEnd;
        this.drops.visible = !this.finished && time >= 0.16 && time < TIMING.dropsEnd;
        this.glow.visible = !this.finished && time > TIMING.growStart && time < TIMING.poolEnd;
    }

    reset(): void {
        if (this.disposed) return;
        this.finished = false;
        this.state.tail = 0;
        this.transformation.reset();
        this.update(0, 800);
    }

    finish(): void {
        this.finished = true;
        this.transformation.finish();
        this.stream.visible = this.pool.visible = this.drops.visible = this.glow.visible = false;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.root.removeFromParent();
        this.transformation.dispose();
        for (const mesh of [this.stream, this.pool, this.drops, this.glow]) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
    }
}
