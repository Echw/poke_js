import * as THREE from 'three';

/** Shared object-space fractures: stable under movement, with no triangulation overlay. */
export const iceFractures = /* glsl */ `
    vec2 iceHash(vec2 p) {
        return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);
    }
    float iceCloud(vec2 p) {
        vec2 cell=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(iceHash(cell).x,iceHash(cell+vec2(1,0)).x,f.x),
            mix(iceHash(cell+vec2(0,1)).x,iceHash(cell+vec2(1,1)).x,f.x),f.y);
    }
    float iceSegment(vec2 p,vec2 a,vec2 b) {
        vec2 line=b-a;
        return length(p-a-line*clamp(dot(p-a,line)/dot(line,line),0.0,1.0));
    }
    float iceCrack(vec3 p) {
        vec2 q=vec2(p.x+p.z*0.63,p.y); float d=8.0, branch=8.0;
        for(int trunk=0;trunk<2;trunk++) for(int step=0;step<7;step++) {
            float t=float(trunk), s=float(step);
            vec2 a=vec2(-0.24+t*0.46+(iceHash(vec2(s,t+4.0)).x-0.5)*0.23,-0.65+s*0.27);
            vec2 b=vec2(-0.24+t*0.46+(iceHash(vec2(s+1.0,t+4.0)).x-0.5)*0.23,-0.65+(s+1.0)*0.27);
            a.x+=a.y*(t-0.5)*0.65; b.x+=b.y*(t-0.5)*0.65;
            d=min(d,iceSegment(q,a,b));
            vec2 fork=a+vec2((t-0.5)*0.34,0.16+iceHash(vec2(s,t)).y*0.12);
            branch=min(branch,iceSegment(q,a,fork));
        }
        float aa=max(fwidth(d),0.0007), ab=max(fwidth(branch),0.0007);
        return (1.0-smoothstep(0.0009,0.0009+aa,d))
            +(1.0-smoothstep(0.0004,0.0004+ab,branch))*0.42;
    }
`;

/** Private HDR light cards affect only ice reflections, never the sky or the Ball. */
export function createIceEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    const width = 256, height = 128, pixels = new Float32Array(width * height * 4);
    const panels = [
        { u: 0.67, v: 0.66, w: 0.042, h: 0.19, color: [4.2, 5.0, 6.0] },
        { u: 0.12, v: 0.57, w: 0.065, h: 0.12, color: [1.6, 2.8, 4.6] },
        { u: 0.78, v: 0.23, w: 0.10, h: 0.10, color: [0.8, 3.5, 7.0] },
    ];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        pixels.set([0.004, 0.012, 0.03, 1], index);
        for (const panel of panels) {
            const delta = Math.abs((x + 0.5) / width - panel.u);
            const du = Math.min(delta, 1 - delta) / panel.w;
            const dv = ((y + 0.5) / height - panel.v) / panel.h;
            const strength = Math.exp(-Math.pow(du, 8) - Math.pow(Math.abs(dv), 8));
            for (let channel = 0; channel < 3; channel++) pixels[index + channel] += panel.color[channel] * strength;
        }
    }
    const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.needsUpdate = true;
    const pmrem = new THREE.PMREMGenerator(renderer);
    try { return pmrem.fromEquirectangular(texture); }
    finally { texture.dispose(); pmrem.dispose(); }
}

/** Shared stable uniforms are updated by IceEffect in world space. */
export interface IceLighting {
    position: { value: THREE.Vector3 };
    energy: { value: number };
}

const interiorGLSL = /* glsl */ `
    float iceInteriorSeam(vec3 p,float seed) {
        vec2 q=vec2(p.x+p.z*0.81,p.y-p.z*0.47)*3.0+seed*vec2(7.13,3.71);
        q+=vec2(iceCloud(q*0.73),iceCloud(q.yx*0.81+3.4))*0.65;
        vec2 cell=floor(q),f=fract(q);float first=9.0,second=9.0;vec2 closest=vec2(0);
        for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
            vec2 offset=vec2(float(x),float(y)),id=cell+offset;
            float distance=length(offset+iceHash(id)*0.86-f);
            if(distance<first){second=first;first=distance;closest=id;}else{second=min(second,distance);}
        }
        float seam=second-first;
        float aa=max(fwidth(seam)*0.8,0.0015);
        float coverage=smoothstep(0.35,0.82,iceHash(closest+seed).x);
        return (1.0-smoothstep(0.006,0.006+aa,seam))*coverage;
    }
`;

/** Refracted interior samples stay inside the actual convex hull of each variant. */
export function createCrystalMaterial(plane: THREE.Plane, environment: THREE.Texture,
    planes: THREE.Vector4[], lighting: IceLighting): THREE.MeshPhysicalMaterial {
    const material = new THREE.MeshPhysicalMaterial({
        color: 0x488fcb, metalness: 0, roughness: 0.035,
        transmission: 0.82, thickness: 0.3, ior: 1.31,
        attenuationColor: 0x1c67be, attenuationDistance: 0.48,
        envMap: environment, envMapIntensity: 0.75, clearcoat: 0.4, clearcoatRoughness: 0.018,
        opacity: 1, depthTest: true, depthWrite: true,
        clippingPlanes: [plane],
    });
    material.onBeforeCompile = shader => {
        shader.uniforms.uIcePlanes = { value: Array.from({ length: 48 }, (_, i) => planes[i] ?? new THREE.Vector4()) };
        shader.uniforms.uIcePlaneCount = { value: planes.length };
        shader.uniforms.uIceLight = lighting.position;
        shader.uniforms.uIceEnergy = lighting.energy;
        shader.vertexShader = shader.vertexShader.replace('#include <common>',
            `#include <common>
            attribute float aIceSeed;varying float vIceSeed;
            attribute vec3 aIceBary,aIceRidges;varying vec3 vIceBary,vIceRidges;
            varying vec3 vIceLocal;varying mat3 vIceWorldToLocal;`);
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
            `#include <begin_vertex>
            vIceLocal=position;vIceSeed=aIceSeed;
            vIceBary=aIceBary;vIceRidges=aIceRidges;
            vIceWorldToLocal=inverse(mat3(modelMatrix*instanceMatrix));`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
            `#include <common>
            uniform vec4 uIcePlanes[48];uniform int uIcePlaneCount;
            uniform vec3 uIceLight;uniform float uIceEnergy;
            varying vec3 vIceLocal;varying float vIceSeed;varying mat3 vIceWorldToLocal;
            varying vec3 vIceBary,vIceRidges;
            ${iceFractures}
            ${interiorGLSL}`);
        const nativeTransmission = THREE.ShaderChunk.transmission_fragment.replace(
            'material.thickness = thickness;', 'material.thickness = iceWorldTravel;');
        shader.fragmentShader = shader.fragmentShader.replace('#include <transmission_fragment>',
            `vec3 iceWorldNormal=transformNormalByInverseViewMatrix(normal,viewMatrix);
            vec3 iceWorldRay=refract(normalize(vWorldPosition-cameraPosition),iceWorldNormal,1.0/ior);
            vec3 iceLocalRaw=vIceWorldToLocal*iceWorldRay;
            float iceRayScale=max(length(iceLocalRaw),0.0001);
            vec3 iceRay=iceLocalRaw/iceRayScale;
            float iceExit=2.0;
            for(int face=0;face<48;face++){
                if(face>=uIcePlaneCount)break;
                vec4 plane=uIcePlanes[face];float denominator=dot(plane.xyz,iceRay);
                if(denominator>0.0001){
                    float distance=-(dot(plane.xyz,vIceLocal)+plane.w)/denominator;
                    if(distance>=-0.00005)iceExit=min(iceExit,max(0.0,distance));
                }
            }
            float iceWorldTravel=clamp(iceExit/iceRayScale,0.005,1.5);
            float iceLight=exp(-length(vWorldPosition-uIceLight)*2.6)*uIceEnergy;
            float iceInterior=0.0,iceClouding=0.0;
            for(int layer=0;layer<3;layer++){
                float depth=0.19+float(layer)*0.27;
                vec3 samplePosition=vIceLocal+iceRay*iceExit*depth;
                float absorption=exp(-iceWorldTravel*depth*1.8);
                iceInterior+=iceInteriorSeam(samplePosition,vIceSeed+float(layer)*1.83)*absorption*(0.68-float(layer)*0.17);
                iceClouding+=iceCloud(samplePosition.xy*9.0+samplePosition.z*6.0+vIceSeed)*absorption*0.16;
            }
            ${nativeTransmission}
            totalEmissiveRadiance+=vec3(0.12,0.58,1.12)*iceInterior*(0.35+iceLight*1.25);
            totalEmissiveRadiance+=vec3(0.055,0.52,1.35)*iceLight*(0.33+iceClouding*0.6);`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
            `vec3 iceRidge=(1.0-smoothstep(vec3(0),max(fwidth(vIceBary)*0.7,vec3(0.0001)),vIceBary))*vIceRidges;
            float iceEdge=max(max(iceRidge.x,iceRidge.y),iceRidge.z);
            float iceGrazing=pow(1.0-abs(dot(normal,normalize(vViewPosition))),3.0);
            float iceSpecular=smoothstep(0.08,0.65,max(max(totalSpecular.r,totalSpecular.g),totalSpecular.b));
            outgoingLight+=vec3(0.35,0.95,1.4)*iceEdge*clamp(iceGrazing*1.2+iceSpecular*0.35+iceLight*0.2,0.0,1.0);
            #include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'ice-physical-interior-v2';
    return material;
}

/** Opaque frost-to-art surface is visible in the crystals' refraction buffer. */
export function createFrozenCardMaterial(source: THREE.MeshBasicMaterial, environment: THREE.Texture,
    image: { value: number }): THREE.MeshBasicMaterial {
    const material = source.clone();
    material.transparent = false;
    material.opacity = 1;
    material.depthWrite = true;
    material.visible = false;
    material.onBeforeCompile = shader => {
        shader.uniforms.uIceImage = image;
        shader.uniforms.uIceEnvironment = { value: environment };
        shader.vertexShader = shader.vertexShader.replace('#include <common>',
            '#include <common>\nvarying vec3 vIceLocal, vIceWorld, vIceNormal;');
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
            `#include <begin_vertex>
            vIceLocal=position;
            vIceWorld=(modelMatrix*vec4(position,1.0)).xyz;
            vIceNormal=normalize(mat3(modelMatrix)*normal);`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
            `#include <common>
            uniform float uIceImage; uniform sampler2D uIceEnvironment;
            varying vec3 vIceLocal, vIceWorld, vIceNormal;
            ${iceFractures}`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
            `#include <map_fragment>
            vec3 V=normalize(cameraPosition-vIceWorld), N=normalize(vIceNormal);
            vec3 reflected=reflect(-V,N);
            vec2 envUV=vec2(atan(reflected.z,reflected.x)*0.15915494+0.5,
                asin(clamp(reflected.y,-1.0,1.0))*0.31830989+0.5);
            vec3 reflection=min(texture2D(uIceEnvironment,envUV).rgb,vec3(2.0));
            float crack=iceCrack(vIceLocal*vec3(1.25,1.0,1.0));
            float cloud=iceCloud(vIceLocal.xy*6.0+reflected.xy*0.25);
            float edge=pow(clamp(max(abs(vIceLocal.x)/0.35,abs(vIceLocal.y)/0.5),0.0,1.0),16.0);
            float rim=pow(1.0-abs(dot(N,V)),3.0);
            vec3 frozen=vec3(0.025,0.16,0.30)+reflection*0.23;
            frozen+=vec3(0.07,0.18,0.24)*cloud*cloud;
            frozen+=vec3(0.24,0.65,0.88)*(crack*0.48+edge*0.8+rim*0.45);
            diffuseColor.rgb=mix(frozen,diffuseColor.rgb,uIceImage);`);
    };
    material.customProgramCacheKey = () => 'ice-card-fractures-v1';
    return material;
}
