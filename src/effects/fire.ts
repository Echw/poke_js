import * as THREE from 'three';
import { CardTransformation } from './cardTransformation';
import type { PokemonRevealEffect } from './types';

const SOURCE = new THREE.Vector3(0, -0.07, 0.43);
const VOLUME_MIN = new THREE.Vector3(-0.92, -0.16, -0.25);
const VOLUME_MAX = new THREE.Vector3(0.92, 1.30, 1.12);

/** A repeatable, linearly filtered density texture, allocated once per effect. */
function makeNoiseTexture(size: number): THREE.Data3DTexture {
    const data = new Uint8Array(size ** 3);
    let seed = 0x713d9b27;
    for (let index = 0; index < data.length; index++) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        data[index] = seed >>> 24;
    }
    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

// The volume and spark emitters evaluate the same source-relative paths.
const pathsGLSL = /* glsl */ `
    const float PI = 3.14159265;
    const float TAU = 6.2831853;
    float streamHeight(float index) {
        return index < 0.5 ? 1.25 : index < 1.5 ? 1.10 : index < 2.5 ? 0.98 : 0.78;
    }
    float streamWidth(float index) {
        return index < 0.5 ? 0.067 : index < 1.5 ? 0.050 : index < 2.5 ? 0.038 : 0.020;
    }
    vec3 streamCenter(float height, float index, float time) {
        float h = clamp(height / streamHeight(index), 0.0, 1.0);
        float bend = 0.09 * sin(height * 6.0 + 0.18 * sin(time * 1.1));
        // Independent lobes gather at the source, open around the card, then peel sideways.
        // Unequal sweeps and phases prevent three offset copies of a helical band.
        float radius = index < 0.5 ? 0.52 : index < 1.5 ? 0.47 : index < 2.5 ? 0.56 : 0.40;
        float sweep = index < 0.5 ? 6.6 : index < 1.5 ? 5.2 : index < 2.5 ? 7.9 : 4.8;
        float phase = index < 0.5 ? 0.0 : index < 1.5 ? 2.3 : index < 2.5 ? 4.4 : 1.1;
        float orbit = radius * pow(max(0.0, sin(PI * h)), 0.55)
            * smoothstep(0.0, 0.16, height)
            * (0.90 + 0.10 * sin(height * 9.0 - time * 1.6 + index * 1.8));
        float angle = h * sweep - time * (0.72 + index * 0.12) + phase
            + 0.20 * sin(height * 11.0 - time * 2.0 + index * 2.1);
        vec2 curl = 0.055 * smoothstep(0.55, 0.98, h)
            * vec2(sin(h * 12.0 - time * 1.9 + index), cos(h * 15.0 - time * 1.4 + index));
        float release = smoothstep(0.58, 0.98, h);
        float releaseAngle = 0.62 * sweep - time * (0.72 + index * 0.12) + phase
            + 0.45 * sin((h - 0.62) * 4.0 + time * 0.7 + index);
        // Follow each tongue's own outward direction instead of pulling it across the card.
        angle = mix(angle, releaseAngle, release);
        orbit = mix(orbit, radius * (1.25 + 0.12 * sin(time * 1.1 + index)), release);
        float x = bend + orbit * cos(angle) + curl.x;
        float z = orbit * sin(angle) * 0.78 + curl.y;
        return vec3(x, height, z);
    }
    vec3 ringCenter(float angle, float index, float time) {
        float radius = 0.42 + index * 0.18
            + 0.035 * sin(angle * 5.0 - time * 1.6 + index)
            + 0.018 * sin(angle * 13.0 + time * 2.2);
        return vec3(radius * cos(angle), 0.012 + index * 0.065
            + 0.014 * sin(angle * 3.0 - time * 1.3 + index),
            radius * sin(angle) * 0.72);
    }
`;

const volumeVertex = /* glsl */ `
    out vec3 vLocalPosition;
    void main() {
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const volumeFragment = /* glsl */ `
    precision highp sampler3D;
    uniform sampler3D uNoise;
    uniform float uNoiseScale, uTime, uGrowth, uVortex, uRings, uCardImage;
    uniform vec3 uCameraLocal, uBoundsMin, uBoundsMax, uSource;
    uniform mat4 uVolumeToCard;
    uniform vec3 uEmber, uBody, uWarm, uHot;
    in vec3 vLocalPosition;
    out vec4 fragColor;
    ${pathsGLSL}

    float noiseAt(vec3 p) {
        return texture(uNoise, p * uNoiseScale).r;
    }
    float streamDistance(vec2 offset, vec2 slope) {
        // Measure across the curved stream, not across a horizontal slice.
        float along = clamp(dot(offset, slope) / (1.0 + dot(slope, slope)), -0.07, 0.07);
        return length(vec3(offset - slope * along, along));
    }
    // Density, density-weighted temperature, conservative empty space distance.
    vec3 fireField(vec3 p) {
        vec3 centers[4];
        vec2 slopes[4];
        float widths[4];
        float gates[4];
        float nearest = 1.0;
        for (int i = 0; i < 4; i++) {
            float index = float(i);
            float h = p.y / streamHeight(index);
            centers[i] = streamCenter(p.y, index, uTime);
            slopes[i] = (streamCenter(p.y + 0.006, index, uTime).xz
                - streamCenter(p.y - 0.006, index, uTime).xz) / 0.012;
            float profile = pow(max(0.0, sin(PI * clamp(h, 0.0, 1.0))), 0.75);
            widths[i] = 0.003 + streamWidth(index) * profile
                * (1.0 - smoothstep(0.76, 1.0, h))
                * (0.76 + 0.24 * sin(p.y * 19.0 - uTime * 4.0 + index * 2.1));
            gates[i] = smoothstep(-0.005, 0.025, p.y)
                * (1.0 - smoothstep(uGrowth - 0.10, uGrowth + 0.015, h))
                * (1.0 - smoothstep(0.95, 1.0, h)) * uVortex;
            if (h >= 0.0 && h < 1.0 && gates[i] > 0.001) {
                nearest = min(nearest, streamDistance(p.xz - centers[i].xz, slopes[i])
                    - widths[i] * 2.4 - 0.065);
            }
        }
        float angle = atan(p.z / 0.72, p.x);
        vec3 ringA = ringCenter(angle, 0.0, uTime);
        vec3 ringB = ringCenter(angle, 1.0, uTime);
        if (uRings > 0.001) {
            nearest = min(nearest, min(length(p - ringA), length(p - ringB)) - 0.16);
        }
        if (nearest > 0.025) return vec3(0.0, 0.0, nearest);
        // Fixed world scale: rising fuel reveals detail rather than stretching it.
        vec3 flow = p * vec3(12.0, 9.0, 12.0) + vec3(0.0, -uTime * 4.5, 0.0);
        float coarse = noiseAt(flow);
        float fine = noiseAt(flow * 2.17 + vec3(11.3, -uTime * 1.1, 7.9));
        float detail = noiseAt(flow * 4.1 + vec3(fine * 2.0, 5.1, coarse * 2.0));
        vec2 warp = vec2(coarse - 0.5, fine - 0.5) * 0.085;
        float density = 0.0;
        float temperature = 0.0;
        for (int i = 0; i < 4; i++) {
            float h = p.y / streamHeight(float(i));
            float radius = widths[i] * (0.55 + 0.90 * coarse);
            float d = streamDistance(p.xz + warp * smoothstep(0.02, 0.45, h) - centers[i].xz, slopes[i])
                / max(radius, 0.003);
            float erosion = smoothstep(0.26, 0.72, fine + max(0.0, 1.0 - d) * 0.30);
            float folds = pow(max(0.0, 1.0 - abs(fine - 0.52) * 5.0), 3.0);
            float body = (1.0 - smoothstep(0.20, 1.35, d)) * erosion * (0.28 + folds * 0.72);
            float filament = exp(-d * d * 16.0) * (0.3 + 0.7 * detail) * 0.80;
            float halo = exp(-d * d * 0.85) * 0.022 * (1.0 - smoothstep(1.4, 2.0, d));
            float tip = mix(1.0, smoothstep(0.28, 0.66, coarse + fine * 0.22),
                smoothstep(0.64, 0.96, h));
            float amount = (body + filament + halo) * gates[i] * tip;
            density += amount;
            float heat = clamp((body * (0.30 + 0.52 * folds) + filament * 1.45)
                / max(body + filament + halo, 0.0001), 0.0, 1.0);
            temperature += amount * heat;
        }
        for (int i = 0; i < 2; i++) {
            float index = float(i);
            vec3 center = i == 0 ? ringA : ringB;
            float cluster = sin(angle * 7.0 - uTime * 2.5 + index * 2.4)
                + 0.38 * sin(angle * 17.0 + uTime * 3.1);
            float broken = smoothstep(-0.70, 0.20, cluster + coarse * 0.60);
            float lift = pow(max(0.0, sin(angle * 11.0 - uTime * 2.4)
                + 0.3 * sin(angle * 23.0 + uTime)), 3.0) * 0.065;
            vec3 delta = p - center;
            float rise = max(0.0, delta.y);
            float underside = smoothstep(-0.026, -0.008, delta.y);
            if (delta.y > 0.0) delta.y /= 1.0 + lift * 24.0;
            delta.xz += warp * 0.65 + vec2(-sin(angle), cos(angle)) * rise * 0.7;
            float width = (0.023 + 0.023 * coarse) * (1.0 - smoothstep(0.02, 0.16, rise));
            float d = length(vec3(delta.x, delta.y, delta.z)) / max(width, 0.002);
            float filament = exp(-d * d * 14.0);
            float amount = ((1.0 - smoothstep(0.12, 1.30, d))
                * smoothstep(0.20, 0.65, fine) * 0.55 + filament
                + 0.02 * exp(-d * d * 0.75))
                * broken * uRings * underside;
            amount *= 1.0 - uCardImage * (1.0 - smoothstep(0.35, 0.48, abs(p.x))) * 0.96;
            density += amount;
            temperature += amount * clamp(0.35 + detail * 0.3 + filament * 0.65, 0.0, 1.0);
        }
        return vec3(density, temperature / max(density, 0.0001), max(nearest, 0.0));
    }
    vec3 fireColor(float heat) {
        vec3 color = mix(uEmber, uBody, smoothstep(0.0, 0.40, heat));
        color = mix(color, uWarm, smoothstep(0.48, 0.92, heat));
        return mix(color, uHot, smoothstep(0.88, 1.0, heat));
    }
    void main() {
        vec3 direction = normalize(vLocalPosition - uCameraLocal);
        vec3 inverseRay = sign(direction + vec3(0.000001)) / max(abs(direction), vec3(0.00001));
        vec3 t0 = (uBoundsMin - uCameraLocal) * inverseRay;
        vec3 t1 = (uBoundsMax - uCameraLocal) * inverseRay;
        vec3 lo = min(t0, t1), hi = max(t0, t1);
        float entry = max(max(lo.x, lo.y), max(lo.z, 0.0));
        float exitDistance = min(min(hi.x, hi.y), hi.z);
        if (entry >= exitDistance) discard;
        // Cover the entire ray even when both rings occupy most of its length.
        float baseStep = max(MIN_STEP, (exitDistance - entry) / float(MARCH_STEPS));
        float travel = entry + baseStep * 0.5;
        vec3 cardOrigin = (uVolumeToCard * vec4(uCameraLocal, 1.0)).xyz;
        vec3 cardDirection = (uVolumeToCard * vec4(direction, 0.0)).xyz;
        float transmission = 1.0;
        vec3 emission = vec3(0.0);
        for (int i = 0; i < MARCH_STEPS; i++) {
            if (travel > exitDistance || transmission < 0.015) break;
            vec3 p = uCameraLocal + direction * travel - uSource;
            vec3 field = fireField(p);
            vec3 cardPoint = cardOrigin + cardDirection * travel;
            vec2 corner = abs(cardPoint.xy) - vec2(0.31, 0.46);
            float cardDistance = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - 0.04;
            float cardCover = 1.0 - smoothstep(-0.005, 0.010, cardDistance);
            float behindCard = 1.0 - smoothstep(0.002, 0.014, cardPoint.z);
            // Rear arcs disappear behind the image; front arcs retain only a little heat over print.
            field.x *= 1.0 - cardCover * uCardImage * mix(0.90, 1.0, behindCard);
            float stepSize = clamp(field.z * 0.55, baseStep, 0.09);
            float opacity = 1.0 - exp(-field.x * stepSize * 16.0);
            emission += transmission * opacity * fireColor(field.y) * 2.8;
            transmission *= 1.0 - opacity;
            travel += stepSize;
        }
        float alpha = 1.0 - transmission;
        if (alpha < 0.00005) discard;
        fragColor = linearToOutputTexel(vec4(emission, alpha));
    }
`;

const sparkVertex = /* glsl */ `
    uniform float uTime, uOpacity, uViewportHeight, uCardImage;
    uniform vec3 uSource;
    attribute vec4 aSpark;
    attribute float aOrigin;
    varying float vAlpha, vLife;
    varying vec2 vDirection;
    ${pathsGLSL}
    void main() {
        float lifetime = 0.25 + aSpark.y * 0.40;
        float life = fract(uTime / lifetime + aSpark.x);
        float age = life * lifetime;
        float birth = uTime - age;
        float growth = clamp((birth - 0.4) / 1.4, 0.0, 1.0);
        float angle = aSpark.w * TAU + floor(uTime / lifetime + aSpark.x) * 2.39996;
        vec3 base = ringCenter(angle, mod(aOrigin, 2.0), birth);
        vec3 origin = base;
        if (aOrigin < 4.0) {
            float height = streamHeight(aOrigin) * aSpark.z * growth;
            vec3 plume = streamCenter(height, aOrigin, birth);
            origin = mix(plume, base, smoothstep(1.8, 2.85, birth));
        }
        vec3 velocity = vec3(cos(angle) * (0.65 + aSpark.y * 0.90),
            0.28 + aSpark.z * 0.65, sin(angle) * (0.50 + aSpark.y * 0.55));
        vec3 point = origin + velocity * age + vec3(0.0, -0.65 * age * age, 0.0) + uSource;
        vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
        vec4 projected = projectionMatrix * viewPosition;
        vec3 currentVelocity = velocity + vec3(0.0, -1.30 * age, 0.0);
        vec4 ahead = projectionMatrix * modelViewMatrix * vec4(point + currentVelocity * 0.015, 1.0);
        vDirection = normalize((ahead.xy / ahead.w - projected.xy / projected.w)
            * vec2(projectionMatrix[1][1] / projectionMatrix[0][0], 1.0) + vec2(0.00001));
        gl_Position = projected;
        gl_PointSize = min(18.0, (0.050 + aSpark.y * 0.025)
            * uViewportHeight / max(0.1, -viewPosition.z)) * (1.0 - life * 0.45);
        vAlpha = smoothstep(0.0, 0.04, life) * (1.0 - smoothstep(0.30, 1.0, life))
            * smoothstep(0.0, 0.10, birth) * uOpacity;
        vAlpha *= 1.0 - uCardImage * (1.0 - smoothstep(0.36, 0.48, abs(point.x))) * 0.88;
        vLife = life;
    }
`;

const sparkFragment = /* glsl */ `
    uniform vec3 uEmber, uWarm, uHot;
    varying float vAlpha, vLife;
    varying vec2 vDirection;
    void main() {
        vec2 p = (gl_PointCoord - 0.5) * vec2(2.0, -2.0);
        float along = dot(p, vDirection);
        float across = dot(p, vec2(-vDirection.y, vDirection.x));
        float diamond = abs(along) + abs(across) * 4.2;
        float needle = 1.0 - smoothstep(0.25, 0.95, diamond);
        float halo = exp(-along * along * 3.0 - across * across * 20.0) * 0.14;
        float alpha = (needle + halo) * vAlpha;
        if (alpha < 0.005) discard;
        vec3 color = mix(uEmber, uWarm, pow(1.0 - vLife, 1.8));
        color = mix(color, uHot, pow(1.0 - vLife, 3.0) * needle);
        gl_FragColor = vec4(color * 1.35, alpha);
        #include <colorspace_fragment>
    }
`;

/** Four rising fire streams and two low arcs share one bounded volume pass. */
export class FireEffect implements PokemonRevealEffect {
    readonly root = new THREE.Group();
    readonly fillLightColor = new THREE.Color(0xff6818);
    readonly fillLightPosition = new THREE.Vector3(0, 0.16, 0.35);
    readonly transformation: CardTransformation;
    readonly state = { growth: 0, vortex: 0, rings: 0, embers: 0, afterglow: 0 };
    private readonly volume: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
    private readonly embers: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
    private readonly noise: THREE.Data3DTexture;
    private readonly cameraLocal = new THREE.Vector3();
    private readonly inverseWorld = new THREE.Matrix4();
    private readonly volumeToCard = new THREE.Matrix4();
    private finished = false;

    get fillLightIntensity(): number {
        if (this.finished) return 0;
        const { core, energy, morph, cardImage, fade } = this.transformation.state;
        return (core * 1.4 + energy * 0.9 + this.state.vortex * 0.7)
            * (1 - morph * 0.4) * (1 - cardImage * 0.85) * fade
            + this.state.afterglow * 0.18;
    }

    constructor(card: THREE.Mesh, mobile = false) {
        this.root.name = 'FireEffect';
        this.transformation = new CardTransformation(card, 'fire', mobile);
        this.root.add(this.transformation.root);
        const colors = {
            uEmber: { value: new THREE.Color(0xd71908) },
            uBody: { value: new THREE.Color(0xff4a08) },
            uWarm: { value: new THREE.Color(0xffb21a) },
            uHot: { value: new THREE.Color(0xfffbe8) },
        };
        const noiseSize = mobile ? 32 : 64;
        this.noise = makeNoiseTexture(noiseSize);
        const size = VOLUME_MAX.clone().sub(VOLUME_MIN);
        const center = VOLUME_MIN.clone().add(VOLUME_MAX).multiplyScalar(0.5);
        const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
        geometry.translate(center.x, center.y, center.z);
        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            defines: { MARCH_STEPS: mobile ? 40 : 64, MIN_STEP: mobile ? '0.017' : '0.011' },
            uniforms: {
                ...colors,
                uNoise: { value: this.noise }, uNoiseScale: { value: 1 / noiseSize },
                uTime: { value: 0 }, uGrowth: { value: 0 }, uVortex: { value: 0 },
                uRings: { value: 0 }, uCardImage: { value: 0 },
                uSource: { value: SOURCE }, uCameraLocal: { value: this.cameraLocal },
                uVolumeToCard: { value: this.volumeToCard },
                uBoundsMin: { value: VOLUME_MIN }, uBoundsMax: { value: VOLUME_MAX },
            },
            vertexShader: volumeVertex, fragmentShader: volumeFragment,
            side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending,
            premultipliedAlpha: true,
            depthTest: false, depthWrite: false, toneMapped: false,
        });
        this.volume = new THREE.Mesh(geometry, material);
        this.volume.name = 'FireVolume';
        this.volume.renderOrder = 3.1;
        this.volume.onBeforeRender = (_renderer, _scene, camera) => {
            this.inverseWorld.copy(this.volume.matrixWorld).invert();
            this.cameraLocal.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(this.inverseWorld);
            card.updateWorldMatrix(true, false);
            this.volumeToCard.copy(card.matrixWorld).invert().multiply(this.volume.matrixWorld);
        };
        this.root.add(this.volume);
        const count = mobile ? 72 : 144;
        const data = new Float32Array(count * 4);
        const origins = new Float32Array(count);
        for (let index = 0; index < count; index++) {
            const offset = index * 4;
            data[offset] = (index * 0.61803398875) % 1;
            data[offset + 1] = (index * 0.38196601125) % 1;
            data[offset + 2] = 0.08 + ((index * 0.754877666) % 1) * 0.80;
            data[offset + 3] = (index * 0.414213562) % 1;
            origins[index] = index % 3 === 0 ? 4 + index % 2 : index % 4;
        }
        const sparkGeometry = new THREE.BufferGeometry();
        sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        sparkGeometry.setAttribute('aSpark', new THREE.BufferAttribute(data, 4));
        sparkGeometry.setAttribute('aOrigin', new THREE.BufferAttribute(origins, 1));
        sparkGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.55, 0.43), 2.0);
        const sparkMaterial = new THREE.ShaderMaterial({
            uniforms: {
                ...colors, uSource: { value: SOURCE },
                uTime: { value: 0 }, uOpacity: { value: 0 },
                uViewportHeight: { value: 800 }, uCardImage: { value: 0 },
            },
            vertexShader: sparkVertex, fragmentShader: sparkFragment,
            transparent: true, blending: THREE.AdditiveBlending,
            depthTest: false, depthWrite: false, toneMapped: false,
        });
        this.embers = new THREE.Points(sparkGeometry, sparkMaterial);
        this.embers.name = 'FireSparks';
        this.embers.renderOrder = 2.05;
        this.root.add(this.embers);
        this.root.visible = false;
    }

    setActive(active: boolean): void {
        this.root.visible = active;
        this.transformation.setActive(active);
        // scene.ts initially assigns all effect descendants renderOrder 2.
        this.volume.renderOrder = 3.1;
        this.embers.renderOrder = 2.05;
    }

    addToTimeline(timeline: gsap.core.Timeline): void {
        this.transformation.addToTimeline(timeline);
        timeline.to(this.state, { rings: 0.40, embers: 0.70,
            duration: 0.35, ease: 'power2.out' }, 0.10);
        timeline.to(this.state, { vortex: 1, duration: 0.40, ease: 'sine.out' }, 0.40);
        timeline.to(this.state, { growth: 1, duration: 1.40, ease: 'none' }, 0.40);
        timeline.to(this.state, { rings: 1, embers: 1,
            duration: 0.78, ease: 'power2.out' }, 0.72);
        timeline.to(this.state, { vortex: 0, duration: 1.05, ease: 'sine.inOut' }, 1.80);
        timeline.to(this.state, { afterglow: 0.95,
            duration: 0.45, ease: 'power2.out' }, 2.40);
        timeline.to(this.state, { afterglow: 0,
            duration: 2.5, ease: 'power2.in' }, 2.85);
    }

    update(time: number, viewportHeight: number): void {
        this.transformation.update(time);
        const shared = this.transformation.state;
        const fade = this.finished ? 0 : shared.fade;
        const afterglow = this.finished ? 0 : this.state.afterglow;
        const uniforms = this.volume.material.uniforms;
        uniforms.uTime.value = time;
        uniforms.uGrowth.value = this.state.growth;
        uniforms.uVortex.value = this.state.vortex * fade * (1 - shared.cardImage * 0.92);
        uniforms.uRings.value = Math.max(this.state.rings * fade, afterglow);
        uniforms.uCardImage.value = shared.cardImage;
        this.volume.visible = uniforms.uVortex.value + uniforms.uRings.value > 0.001;
        const sparks = this.embers.material.uniforms;
        sparks.uTime.value = time;
        sparks.uViewportHeight.value = viewportHeight;
        sparks.uCardImage.value = shared.cardImage;
        sparks.uOpacity.value = Math.max(this.state.embers * fade, afterglow * 0.70);
        this.embers.visible = sparks.uOpacity.value > 0.001;
    }

    reset(): void {
        this.finished = false;
        this.transformation.reset();
        Object.assign(this.state, { growth: 0, vortex: 0, rings: 0, embers: 0, afterglow: 0 });
        this.update(0, 800);
    }

    finish(): void {
        this.finished = true;
        this.transformation.finish();
    }

    dispose(): void {
        this.root.removeFromParent();
        this.transformation.dispose();
        this.volume.geometry.dispose();
        this.volume.material.dispose();
        this.noise.dispose();
        this.embers.geometry.dispose();
        this.embers.material.dispose();
    }
}
