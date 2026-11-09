import * as THREE from 'three';
import { spectralFlowGLSL } from './ghostVolume';

// Curves, density and card corridor all use the Ball's local coordinate system.
const vertexShader = /* glsl */ `
    uniform float uTime, uReveal, uRetreat, uSpread;
    attribute float aT, aSide, aRibbon, aStrand;
    varying float vT, vSide, vPhase, vBranch;
    varying vec3 vPosition;
    void main() {
        float id = aRibbon;
        float side = mod(id, 2.0) < 0.5 ? -1.0 : 1.0;
        float back = step(1.5, id);
        float secondary = step(3.5, id);
        float phase = id * 1.73;
        float speed = 0.48 + id * 0.085;
        float release = smoothstep(0.42 + id * 0.09, 0.65 + id * 0.09, uTime);
        float clock = uTime * speed + release * 0.22;
        float length = uReveal * (1.0 - uRetreat * 0.27);
        float t = mix(aT, 0.48 + aT * 0.52, aStrand) * length;
        float arch = sin(t * 3.14159);
        float angle = t * (6.8 + back) - clock + phase;
        float spread = mix(1.30, 1.05, back) * mix(1.0, 0.82, secondary);
        float height = mix(1.25, 1.48, back) * mix(1.0, 0.78, secondary);
        vec3 center = vec3(
            side * (t * spread + sin(angle) * arch * 0.24),
            -0.28 + t * height + sin(angle * 0.72) * arch * 0.12,
            0.50 - t * mix(0.18, 0.76, back) + cos(angle) * arch * 0.13);
        center.z += secondary * t * 0.17;
        float branch = smoothstep(0.48, 0.95, t) * aStrand;
        center.xy += vec2(side * 0.23, mix(0.18, -0.16, back)) * branch;
        float curl = smoothstep(0.65, 1.0, t);
        center.x += side * sin(t * 13.0 - clock * 1.2 + phase) * curl * 0.09;
        center.x *= uSpread;
        float width = (0.045 + arch * 0.20) * (1.0 - smoothstep(0.64, 1.0, t));
        width *= (0.66 + 0.24 * sin(t * 17.0 - clock * 1.8 + phase)
            + 0.10 * sin(t * 37.0 + phase)) * mix(1.0, 0.30, aStrand);
        width *= mix(1.0, 0.65, secondary);
        vec3 across = normalize(vec3(-height, side * spread, sin(angle) * 0.65));
        vec3 p = center + across * aSide * width;
        // Forks begin inside the parent stream, with a soft root in the fragment pass.
        vT = aT; vSide = aSide; vPhase = phase; vBranch = aStrand;
        vPosition = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    uniform float uTime, uOpacity, uRetreat;
    varying float vT, vSide, vPhase, vBranch;
    varying vec3 vPosition;
    ${spectralFlowGLSL}
    float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p) {
        vec2 i=floor(p), f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
            mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
    }
    void main() {
        float clock = uTime * (0.70 + vPhase * 0.045);
        float ghost = spectralMatter(vPosition + vec3(vPhase, 0.0, vSide * 0.025), clock);
        vec2 advected=vec2(vSide*1.6+vPhase,vT*7.0-clock*1.1);
        float smoke=noise(advected+noise(advected*1.7)*0.8)*0.7+noise(advected*2.3)*0.3;
        float matter = mix(ghost,smoke,0.68);
        float flow = spectralFlowLight(vT, vPhase, clock);
        float warp = sin(vT * 23.0 - clock * 2.2 + vPhase) * 0.13
            + sin(vT * 51.0 - clock * 3.1 + vPhase) * 0.055;
        float crossSection = abs(vSide + warp);
        float softEdge = 1.0 - smoothstep(0.58, 1.0, crossSection);
        float holes = smoothstep(0.13, 0.63, matter + (1.0 - vT) * 0.18);
        float ends = smoothstep(0.0, mix(0.035, 0.18, vBranch), vT)
            * (1.0 - smoothstep(0.71, 1.0, vT + (1.0 - matter) * 0.11));
        float rim = exp(-pow((crossSection - 0.63 + warp) * 8.0, 2.0));
        float crease = pow(max(0.0, sin(vSide * 8.0 + vT * 17.0 - clock * 2.5
            + smoke * 4.0 + sin(vT * 29.0 - clock) * 0.7)), 12.0);
        float accent = (rim * 0.65 + crease * 0.38) * (0.14 + 0.86 * flow) * holes;
        // Later front smoke opens a clear corridor before the illustration appears.
        float corridor = smoothstep(0.20, 0.46, abs(vPosition.x));
        float clearCard = mix(1.0, corridor, uRetreat);
        float alpha = uOpacity * ends * clearCard * mix(1.0, 0.45, vBranch);
        alpha *= mix(1.0, 0.60, step(6.0, vPhase));
        #ifdef DARK_EDGE
        gl_FragColor = vec4(vec3(0.85, 0.003, 0.075), alpha * accent * softEdge * 0.62);
        #else
        vec3 color = mix(vec3(0.012, 0.0005, 0.003), vec3(0.12, 0.0018, 0.025), matter * 0.65);
        color += vec3(0.37, 0.001, 0.032) * accent;
        gl_FragColor = vec4(color, alpha * softEdge * (0.20 + matter * 0.65) * holes);
        #endif
        #include <colorspace_fragment>
    }
`;

/** Two passes share geometry/uniforms: absorbing wine matter and sparse crimson emission. */
export function createDarkMaterials(): [THREE.ShaderMaterial, THREE.ShaderMaterial] {
    const uniforms = {
        uTime: { value: 0 }, uReveal: { value: 0 }, uRetreat: { value: 0 }, uOpacity: { value: 0 },
        uSpread: { value: 1 },
    };
    const create = (edge: boolean) => new THREE.ShaderMaterial({
        uniforms, vertexShader, fragmentShader, defines: edge ? { DARK_EDGE: 1 } : {},
        transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide,
        forceSinglePass: true, toneMapped: false,
        blending: edge ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    return [create(false), create(true)];
}

/** Fighting's stateless birth/lifetime emitter, tuned to a few slow, cool-red motes. */
export function createDarkMotes(mobile: boolean): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const count = mobile ? 9 : 14;
    const velocities = [], births = [], sizes = [], lifetimes = [];
    for (let i = 0; i < count; i++) {
        const seed = (Math.sin(i * 127.1 + 719) * 43758.5453) % 1;
        const random = Math.abs(seed);
        velocities.push((i % 2 ? 1 : -1) * (0.23 + random * 0.62), 0.18 + random * 0.32, (random - 0.5) * 0.38);
        births.push(0.35 + i * 0.16); sizes.push(0.007 + random * 0.009);
        lifetimes.push(0.45 + random * 0.95);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aVelocity', new THREE.Float32BufferAttribute(velocities, 3));
    geometry.setAttribute('aBirth', new THREE.Float32BufferAttribute(births, 1));
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute('aLife', new THREE.Float32BufferAttribute(lifetimes, 1));
    const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uHeight: { value: 800 }, uOpacity: { value: 0 } },
        vertexShader: `uniform float uTime,uHeight; attribute vec3 aVelocity;
            attribute float aBirth,aSize,aLife; varying float vFade;
            void main(){float age=max(0.0,uTime-aBirth);
                vFade=smoothstep(0.0,0.08,uTime-aBirth)*(1.0-smoothstep(aLife*0.25,aLife,age));
                vec3 p=vec3(0.0,-0.28,0.50)+aVelocity*age;
                p.x+=sin(age*1.7+aBirth)*age*0.035;
                vec4 view=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*view;
                gl_PointSize=clamp(aSize*uHeight/max(0.1,-view.z),1.0,6.0);}`,
        fragmentShader: `uniform float uOpacity;varying float vFade;
            void main(){float d=length(gl_PointCoord-0.5)*2.0;
                float alpha=(1.0-smoothstep(0.0,1.0,d))*vFade*uOpacity;
                gl_FragColor=vec4(vec3(1.0,0.006,0.065),alpha);
                #include <colorspace_fragment>
            }`,
        transparent: true, depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'DarkMotes'; points.frustumCulled = false; points.renderOrder = 2;
    return points;
}
