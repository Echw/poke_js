import * as THREE from 'three';

/** Joined, non-convex strata with broad broken tops and deep wandering edge notches. */
export function createGroundPillar(variant: number): THREE.BufferGeometry {
    const sides = 20, rings = 13, positions: number[] = [], colors: number[] = [], indices: number[] = [];
    const phase = variant * 1.731;
    for (let ring = 0; ring < rings; ring++) {
        const t = ring / (rings - 1);
        for (let side = 0; side < sides; side++) {
            const angle = side / sides * Math.PI * 2;
            const seam = Math.abs(Math.sin(angle * 1.5 + t * 0.7 + phase));
            const notch = (1 - THREE.MathUtils.smoothstep(seam, 0.02, 0.21)) * 0.17;
            const ledge = Math.sin(Math.floor(ring / 2) * 5.4 + phase + Math.floor(side / 3) * 0.8) * 0.095;
            const broad = Math.sin(angle * 3 + phase + t * 2) * 0.085 + Math.cos(angle * 5 - t * 4 + phase) * 0.055;
            const radius = 0.55 + broad + ledge - notch - t * 0.15 + Math.sin(t * Math.PI) * 0.04;
            const top = 0.93 + Math.cos(angle + phase) * 0.065 + Math.sin(side * 4.7 + phase) * 0.035;
            const y = t * top + (ring > 0 && ring < rings - 1 ? Math.sin(side * 3.1 + ring + phase) * 0.013 : 0);
            positions.push(Math.cos(angle) * radius + t * Math.sin(phase) * 0.07, y,
                Math.sin(angle) * radius + Math.sin(t * 5 + phase) * 0.065);
            const shade = 0.93 + Math.sin(ring * 2.1 + phase) * 0.045 - notch * 0.8;
            colors.push(shade, shade, shade);
        }
    }
    for (let ring = 0; ring < rings - 1; ring++) for (let side = 0; side < sides; side++) {
        const a = ring * sides + side, b = ring * sides + (side + 1) % sides;
        indices.push(a, a + sides, b, b, a + sides, b + sides);
    }
    // Fan caps retain the wide, uneven top; there is no single elevated apex.
    for (const top of [false, true]) {
        const center = positions.length / 3, offset = top ? (rings - 1) * sides : 0;
        positions.push(top ? Math.sin(phase) * 0.07 : 0, top ? 0.93 : 0, top ? Math.sin(5 + phase) * 0.065 : Math.sin(phase) * 0.065);
        colors.push(0.94, 0.94, 0.94);
        for (let side = 0; side < sides; side++) {
            const a = offset + side, b = offset + (side + 1) % sides;
            indices.push(center, top ? b : a, top ? a : b);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return geometry;
}

/** Triplanar maps for non-UV rocks. Await ready before drawing; material disposal owns both maps. */
export function createGroundMaterial(floor: THREE.Plane): { material: THREE.MeshStandardMaterial; ready: Promise<void> } {
    const material = new THREE.MeshStandardMaterial({ color: 0xe4c49e, roughness: 0.96, metalness: 0,
        vertexColors: true, flatShading: true, clippingPlanes: [floor] });
    const color = { value: null as THREE.Texture | null };
    const surface = { value: null as THREE.Texture | null };
    const textures: THREE.Texture[] = [];
    let disposed = false;
    const loader = new THREE.TextureLoader();
    const load = async (url: string, srgb: boolean) => {
        const texture = await loader.loadAsync(url);
        if (disposed) { texture.dispose(); return null; }
        texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = 4;
        textures.push(texture);
        return texture;
    };
    const ready = Promise.all([
        load('/textures/ground/rock-color.webp', true).then(texture => { color.value = texture; }),
        load('/textures/ground/rock-surface.webp', false).then(texture => { surface.value = texture; }),
    ]).then(() => undefined);
    material.addEventListener('dispose', () => {
        if (disposed) return;
        disposed = true;
        for (const texture of textures) texture.dispose();
    });
    material.onBeforeCompile = shader => {
        shader.uniforms.uRockColor = color;
        shader.uniforms.uRockSurface = surface;
        shader.vertexShader = 'varying vec3 vSoil;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            vSoil=position*vec3(length(modelMatrix[0].xyz),length(modelMatrix[1].xyz),length(modelMatrix[2].xyz));
            #ifdef USE_INSTANCING
            vSoil*=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
            #endif
        `);
        shader.fragmentShader = `varying vec3 vSoil;
            uniform sampler2D uRockColor,uRockSurface;
            vec4 rockSample(sampler2D tex,vec3 p,vec3 w){
                return texture2D(tex,p.yz)*w.x+texture2D(tex,p.xz)*w.y+texture2D(tex,p.xy)*w.z;
            }
            ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
            #include <color_fragment>
            vec3 rockWeights=pow(abs(normalize(cross(dFdx(vSoil),dFdy(vSoil)))),vec3(4.0));
            rockWeights/=max(dot(rockWeights,vec3(1.0)),0.0001);
            vec3 rockUV=vSoil*1.65+vec3(0.13,0.27,0.41);
            vec2 rockSurface=rockSample(uRockSurface,rockUV,rockWeights).rg;
            diffuseColor.rgb*=rockSample(uRockColor,rockUV,rockWeights).rgb;
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
            #include <roughnessmap_fragment>
            roughnessFactor=clamp(rockSurface.g,0.82,1.0);
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
            #include <normal_fragment_maps>
            float soilRelief=rockSurface.r*0.028;
            vec3 soilDx=dFdx(-vViewPosition),soilDy=dFdy(-vViewPosition);
            vec3 soilR1=cross(soilDy,normal),soilR2=cross(normal,soilDx);
            float soilDet=dot(soilDx,soilR1);
            normal=normalize(abs(soilDet)*normal-sign(soilDet)*(dFdx(soilRelief)*soilR1+dFdy(soilRelief)*soilR2));
        `);
    };
    material.customProgramCacheKey = () => 'ground-rock-triplanar-v2';
    return { material, ready };
}
