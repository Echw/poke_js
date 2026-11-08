import * as THREE from 'three';

/** Positions and flow are Ball-local; the shared field also carries feather vertices. */
const windField = /* glsl */ `
    const float TAU = 6.28318530718;
    uniform float uTime;
    uniform float uGrowth;
    vec3 windPoint(float h, float angle, float spread) {
        float radius = (0.055 + 0.64 * pow(max(h, 0.0), 0.82)) * spread;
        radius *= 1.0 + 0.055 * sin(angle * 3.0 - uTime * 2.0 + h * 7.0);
        vec3 axis = vec3(0.095 * sin(h * 5.5 - uTime * 0.65) * h,
            -0.07 + h * 1.43, 0.38 + 0.055 * sin(h * 4.0 + uTime * 0.7) * h);
        return axis + vec3(cos(angle) * radius, 0.024 * sin(angle * 2.0 + h * 6.0) * h,
            sin(angle) * radius * 0.72);
    }
    float windAngle(float h, float band) {
        return h * (9.4 + band * 0.25) - uTime * (2.4 + band * 0.17) + band * 0.38
            + 0.14 * sin(h * 13.0 - uTime * 1.5 + band);
    }
`;

const vertex = /* glsl */ `
    ${windField}
    uniform mat4 uWindToCard;
    varying vec3 vCardPosition;
    varying float vHeight;
    varying float vAngle;
    varying float vSide;
    varying float vStrand;
    varying float vBand;
    varying vec2 vUv;
    varying float vLife;
    #ifdef RIBBON
    attribute float aT;
    attribute float aSide;
    attribute float aRibbon;
    attribute float aStrand;
    #endif
    #ifdef FEATHER
    attribute vec4 aFlight;
    #endif
    void main() {
        float h = uv.y;
        float angle = uv.x * TAU;
        vSide = 0.0;
        vStrand = 0.0;
        vBand = 0.0;
        vLife = 1.0;
        vUv = uv;
        vec3 point;
        #ifdef RIBBON
        h = aT;
        angle = windAngle(h, aRibbon) + aStrand * 0.14;
        float taper = smoothstep(0.0, 0.09, h) * (1.0 - smoothstep(0.78, 1.0, h));
        float width = mix(0.13, 0.036, aStrand) * taper
            * (0.8 + 0.2 * sin(h * 23.0 - uTime * 3.0 + aRibbon));
        // Lifted outer ends detach from the main cone instead of forming a rim.
        float spread = 1.0 + aStrand * 0.035 + smoothstep(0.76, 1.0, h) * 0.20;
        point = windPoint(h, angle, spread);
        point += normalize(vec3(cos(angle) * 0.24, 1.0, sin(angle) * 0.24)) * aSide * width;
        vSide = aSide;
        vStrand = aStrand;
        vBand = aRibbon;
        #elif defined(FEATHER)
        float age = (uTime - aFlight.x) / aFlight.y;
        float travel = clamp(age, 0.0, 1.0);
        h = 0.06 + travel * 0.98;
        angle = windAngle(h, aFlight.w * 2.0) + aFlight.z;
        float escape = smoothstep(0.60, 1.0, travel);
        point = windPoint(h, angle, 1.05 + escape * 0.48);
        point.y += escape * 0.08;
        float roll = 0.6 * sin(uTime * 2.8 + aFlight.z) + angle * 0.25;
        float pitch = 0.42 * sin(uTime * 3.1 + aFlight.z);
        float yaw = 0.65 * sin(uTime * 2.0 + aFlight.z);
        vec3 feather = position * (0.82 + aFlight.w * 0.24);
        feather.z += sin(uv.y * 3.14159) * 0.025 * sin(uTime * 4.0 + aFlight.z);
        feather.xy = mat2(cos(roll), sin(roll), -sin(roll), cos(roll)) * feather.xy;
        feather.yz = mat2(cos(pitch), sin(pitch), -sin(pitch), cos(pitch)) * feather.yz;
        feather.xz = mat2(cos(yaw), sin(yaw), -sin(yaw), cos(yaw)) * feather.xz;
        point += feather;
        vLife = smoothstep(0.0, 0.13, age) * (1.0 - smoothstep(0.77, 1.0, age));
        #else
        point = windPoint(h, angle, 1.0);
        #endif
        vHeight = h;
        vAngle = angle;
        vCardPosition = (uWindToCard * vec4(point, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
    }
`;

const fragment = /* glsl */ `
    ${windField}
    uniform float uOpacity;
    uniform float uImage;
    uniform float uMorph;
    uniform float uPass;
    uniform float uBands;
    uniform float uHighlights;
    uniform vec3 uCameraCard;
    uniform vec3 uBlue;
    uniform vec3 uSilver;
    uniform sampler2D uMap;
    varying vec3 vCardPosition;
    varying float vHeight;
    varying float vAngle;
    varying float vSide;
    varying float vStrand;
    varying float vBand;
    varying vec2 vUv;
    varying float vLife;

    float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
            mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    // Intersect the view ray with the near card face in card-local space. Outside
    // its rounded outline no card occlusion exists. This also works during rotation.
    bool behindCard() {
        vec3 ray = vCardPosition - uCameraCard;
        if (abs(ray.z) < 0.00001) return false;
        float face = uCameraCard.z >= 0.0 ? 0.01 : -0.01;
        float t = (face - uCameraCard.z) / ray.z;
        vec2 hit = uCameraCard.xy + t * ray.xy;
        vec2 q = abs(hit) - vec2(0.31, 0.46);
        float outline = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.04;
        return t > 0.0 && t < 1.0 && outline < 0.0;
    }
    // Gaussian packets live ON the same winding paths as the visible ribbons.
    // x = soft surrounding light, y = short near-white core.
    vec2 glints(float h, float angle) {
        vec2 light = vec2(0.0);
        for (int i = 0; i < 3; i++) {
            float band = float(i);
            if (band >= uBands) continue;
            float period = 0.83 + band * 0.17;
            float age = mod(uTime - 0.28 - band * 0.16, period);
            float life = 0.62 + band * 0.06;
            float birth = uTime - age;
            float envelope = smoothstep(0.0, 0.07, age) * (1.0 - smoothstep(life*0.60, life, age))
                * smoothstep(0.12, 0.34, birth) * (1.0 - smoothstep(1.8, 2.65, uTime));
            float center = 0.12 + age * (1.10 + band * 0.12);
            float d = atan(sin(angle - windAngle(h, band)), cos(angle - windAngle(h, band)));
            float length = mix(0.025, 0.095, smoothstep(0.01, 0.24, age));
            float along = (h-center) / length;
            light.x += exp(-along*along*0.65 - d*d*12.0) * envelope;
            light.y += exp(-along*along*2.2 - d*d*100.0) * envelope;
        }
        return light * uHighlights;
    }
    void main() {
        bool behind = behindCard();
        if ((uPass < 0.5 && !behind) || (uPass > 0.5 && behind)) discard;
        float h = vHeight;
        float top = 1.0 - smoothstep(uGrowth - 0.10, uGrowth + 0.02, h);
        float taper = smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.80, 1.0, h));
        float centerClear = 1.0 - smoothstep(0.26, 0.56, abs(vCardPosition.x));
        float clearance = behind ? 1.0 : 1.0 - centerClear * (uMorph * 0.30 + uImage * 0.65);
        vec2 light = glints(h, vAngle);
        float alpha;
        vec3 color;
        #ifdef FEATHER
        vec4 texel = texture2D(uMap, vUv);
        alpha = texel.a * vLife * uOpacity;
        color = texel.rgb;
        #elif defined(RIBBON)
        float edge = pow(max(0.0, 1.0 - abs(vSide)), 1.7);
        float core = exp(-vSide*vSide*38.0);
        float flow = 0.26 + 0.74 * smoothstep(-0.65, 0.8,
            sin(h*32.0-uTime*13.0+vAngle*0.7) + 0.3*sin(h*71.0-uTime*21.0));
        alpha = (edge * 0.22 + core * 0.30) * flow + light.x * edge * 0.36 + light.y * core * 0.90;
        alpha *= mix(1.0, 0.40, vStrand) / (1.0 + vBand * 0.8) * top * taper * uOpacity * clearance;
        color = mix(uBlue, uSilver, clamp(core*0.32 + light.y, 0.0, 1.0));
        color += vec3(0.42, 0.48, 0.56) * light.y;
        #else
        float spiral = vAngle - windAngle(h, 0.0);
        vec2 uvFlow = vec2(sin(spiral)*2.5, h*9.0-uTime*3.5);
        float density = noise(uvFlow + noise(uvFlow*1.7)*0.7);
        float threads = smoothstep(0.05, 0.9, sin(spiral*3.0 + density*3.0));
        float holes = smoothstep(0.22, 0.66, density);
        float wrapped = atan(sin(spiral), cos(spiral));
        float broadBand = exp(-wrapped*wrapped*2.3);
        alpha = (0.045 + threads*0.12 + broadBand*0.30) * holes + light.x*0.17;
        alpha *= top * taper * uOpacity * clearance;
        color = mix(uBlue, uSilver, clamp(threads*0.18 + light.y*0.65, 0.0, 1.0));
        #endif
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color, min(alpha, 0.94));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

/** Stable uniforms; caller supplies the two complementary card-compositing passes. */
export function flyingMaterial(kind: 'body' | 'ribbon' | 'feather', bands: number,
    pass: number, texture?: THREE.Texture): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 }, uGrowth: { value: 0 }, uOpacity: { value: 0 },
            uImage: { value: 0 }, uMorph: { value: 0 }, uPass: { value: pass },
            uHighlights: { value: 1 }, uBands: { value: bands }, uMap: { value: texture ?? null },
            uWindToCard: { value: new THREE.Matrix4() }, uCameraCard: { value: new THREE.Vector3() },
            uBlue: { value: new THREE.Color(0x568ee2) }, uSilver: { value: new THREE.Color(0xecf6ff) },
        },
        defines: kind === 'ribbon' ? { RIBBON: 1 } : kind === 'feather' ? { FEATHER: 1 } : {},
        vertexShader: vertex, fragmentShader: fragment,
        transparent: true, depthTest: true, depthWrite: false,
        blending: kind === 'feather' ? THREE.NormalBlending : THREE.AdditiveBlending,
        side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
    });
}
