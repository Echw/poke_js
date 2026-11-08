import * as THREE from 'three';

export const bugRibbonVertex = /* glsl */ `
    uniform float uTime;
    uniform float uMorph;
    attribute float aT;
    attribute float aSide;
    attribute float aRibbon;
    varying float vT;
    varying float vSide;
    varying float vRibbon;
    varying float vX;
    void main() {
        float id = aRibbon;
        float phase = id * 2.39996;
        float angle = aT * (7.4 + id * 0.8) + phase + uTime * (0.18 + id * 0.09);
        angle += 0.28 * sin(aT * 13.0 - uTime * 0.8 + phase);
        float radius = mix(0.10, 0.62 + id * 0.065, smoothstep(0.0, 0.34, aT));
        radius *= 1.0 + 0.055 * sin(aT * 19.0 - uTime + phase);
        float height = -0.04 + aT * (0.53 + id * 0.10) + (0.18 + id * 0.035) * sin(angle + phase);
        vec3 center = vec3(radius * cos(angle), height, 0.40 + radius * sin(angle) * 0.65);
        center.x *= 1.0 + 0.14 * uMorph;
        float taper = smoothstep(0.0, 0.12, aT) * (1.0 - smoothstep(0.76, 1.0, aT));
        float width = (0.048 + 0.014 * sin(aT * 26.0 + phase - uTime)) * taper;
        vec3 across = normalize(vec3(0.24 * cos(angle), 1.0, 0.2 * sin(angle)));
        vT = aT; vSide = aSide; vRibbon = id;
        vX = center.x;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(center + across * aSide * width, 1.0);
    }
`;
export const bugRibbonFragment = /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform float uMorph;
    varying float vT;
    varying float vSide;
    varying float vRibbon;
    varying float vX;
    void main() {
        float id = vRibbon;
        float soft = exp(-vSide * vSide * 4.2);
        float core = exp(-vSide * vSide * 110.0);
        float taper = smoothstep(0.0, 0.10, vT) * (1.0 - smoothstep(0.78, 1.0, vT));
        float flow = 0.20 + 0.80 * smoothstep(-0.55, 0.65, sin(vT * 23.0 - uTime * (3.1 + id * 0.7) + id * 2.4));
        // Staggered births limit concurrent flares to two; each travels at its own speed.
        float cycle = fract((uTime - 0.36 - id * 0.33) / 1.32);
        float flight = clamp(cycle / (0.25 + id * 0.025), 0.0, 1.0);
        float life = smoothstep(0.0, 0.07, flight) * (1.0 - smoothstep(0.58, 1.0, flight));
        float head = mix(0.12, 0.94, flight);
        float d = vT - head;
        float flare = exp(-pow(d / (0.016 + flight * 0.015), 2.0));
        float tail = exp(d * 32.0) * (1.0 - smoothstep(-0.006, 0.0, d));
        tail *= step(-0.20, d);
        float sparks = (flare + tail * 0.38) * life * smoothstep(0.35, 0.55, uTime);
        float alpha = (soft * 0.13 + core * 0.42) * flow + sparks * (core * 2.4 + soft * 0.85);
        alpha *= mix(1.0, mix(0.12,0.8,smoothstep(0.30,0.53,abs(vX))),uMorph);
        vec3 color = mix(vec3(0.25,0.48,0.008), vec3(0.75,1.0,0.06), core);
        color = mix(color, vec3(1.25,1.18,0.54), clamp(sparks * 1.7 + core * 0.22,0.0,1.0));
        gl_FragColor = vec4(color, alpha * taper * uOpacity);
        #include <colorspace_fragment>
    }
`;

export const fireflyVertex = /* glsl */ `
    uniform float uViewportHeight;
    attribute float aSize;
    attribute float aLight;
    varying float vLight;
    void main() {
        vec4 p = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * p;
        gl_PointSize = min(36.0, aSize * uViewportHeight / max(0.1,-p.z));
        vLight = aLight;
    }
`;
export const fireflyFragment = /* glsl */ `
    varying float vLight;
    void main() {
        vec2 p = (gl_PointCoord - 0.5) * 2.0;
        float r = dot(p,p);
        float core = exp(-r * 45.0);
        float halo = exp(-r * 6.0);
        vec3 color = mix(vec3(0.61,0.85,0.015),vec3(1.4,1.3,0.65),core);
        gl_FragColor = vec4(color,(core + halo * 0.40) * vLight * (1.0-smoothstep(0.7,1.0,r)));
        #include <colorspace_fragment>
    }
`;

/** A paired, narrow insect membrane with a common root, never a leaf silhouette. */
export function makeWingGeometry(): THREE.BufferGeometry {
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (let wing = 0; wing < 2; wing++) {
        const base = positions.length / 3;
        const angle = wing === 0 ? -0.21 : 0.46;
        for (let i = 0; i <= 32; i++) {
            const t = i / 32;
            const width = Math.pow(Math.sin(t * Math.PI), 0.65) * (wing ? 0.038 : 0.044);
            for (let s = 0; s <= 6; s++) {
                const side = s / 3 - 1;
                const x = side * width, y = t * (wing ? 0.28 : 0.34);
                positions.push(x * Math.cos(angle) + y * Math.sin(angle), y * Math.cos(angle) - x * Math.sin(angle), 0.018 * Math.sin(t * Math.PI) * (1-side*side));
                uvs.push(s / 6, t);
                if (i < 32 && s < 6) {
                    const n = base + i * 7 + s;
                    indices.push(n,n+7,n+1,n+1,n+7,n+8);
                }
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    return geometry;
}

export function makeWingMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: { uOpacity: {value:0}, uTime:{value:0} },
        vertexShader: `varying vec2 vUv; varying float vFacing; varying float vPhase;
            void main(){vUv=uv; vFacing=abs(normalize(normalMatrix*mat3(instanceMatrix)*normal).z);
            vPhase=instanceMatrix[3].x*4.0+instanceMatrix[3].y*7.0;
            gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
        fragmentShader: `uniform float uOpacity; uniform float uTime; varying vec2 vUv; varying float vFacing; varying float vPhase;
            void main(){float s=abs(vUv.x*2.0-1.0); float border=smoothstep(0.82,0.98,s);
            float mainVein=exp(-pow((vUv.x-0.5)*70.0,2.0));
            float branches=pow(0.5+0.5*cos((vUv.y*9.0-abs(vUv.x-0.5)*3.5)*6.283),22.0);
            float longitudinal=pow(0.5+0.5*cos(vUv.x*25.13+sin(vUv.y*8.0)),26.0);
            float veins=max(mainVein,max(branches*0.7,longitudinal*0.45));
            float sheen=pow(0.5+0.5*sin(vUv.y*6.0-uTime*2.0+vPhase),8.0)*(0.4+0.6*vFacing);
            float edgeLight=exp(-pow((s-0.88)*8.0,2.0));
            vec3 color=mix(vec3(0.42,0.54,0.07),vec3(1.45,1.32,0.60),clamp(border+veins*0.55+sheen*0.55,0.0,1.0));
            float alpha=0.045+edgeLight*0.25+border*0.58+veins*0.28+sheen*(veins*0.40+0.12);
            gl_FragColor=vec4(color,alpha*uOpacity);
            #include <colorspace_fragment>
            }`,
        transparent:true, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthTest:true, depthWrite:false, forceSinglePass:true, toneMapped:false,
    });
}

