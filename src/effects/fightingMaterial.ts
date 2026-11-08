import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** Six watertight silhouettes, baked once. Shared positions stay joined during flight. */
export function createEarthGeometry(variant: number): THREE.BufferGeometry {
    const source = new THREE.IcosahedronGeometry(1, variant < 3 ? 3 : 2);
    source.deleteAttribute('normal');
    source.deleteAttribute('uv');
    const geometry = mergeVertices(source);
    source.dispose();
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 3);
    const phase = variant * 2.73;
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const broad = Math.sin(x * 3.6 + phase) * Math.cos(y * 4.2 - phase) * Math.sin(z * 3.1 + 0.7);
        const chip = Math.sin(x * 13 + phase) * Math.sin(y * 11 + 1.2) * Math.cos(z * 15 - phase);
        const radius = 0.79 + broad * 0.22 + chip * (variant < 3 ? 0.075 : 0.035);
        positions.setXYZ(i, x * radius * (0.82 + variant * 0.07),
            y * radius * (variant % 2 ? 0.74 : 1.05), z * radius * (variant % 3 === 0 ? 0.72 : 0.96));
        const cavity = THREE.MathUtils.clamp(0.65 + broad * 0.5 + chip * 0.16, 0.32, 1);
        color.setScalar(cavity);
        color.toArray(colors, i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

/** Object-local grain and narrow, sparse cracks; native lights supply the red bounce. */
export function createEarthMaterial(energy: THREE.IUniform<number>): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96,
        metalness: 0, vertexColors: true, flatShading: true });
    material.onBeforeCompile = shader => {
        shader.uniforms.uEarthEnergy = energy;
        shader.vertexShader = 'attribute float aEarthSeed; varying vec3 vEarth; varying float vEarthSeed;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\nvEarth=position; vEarthSeed=aEarthSeed;');
        shader.fragmentShader = `varying vec3 vEarth; varying float vEarthSeed; uniform float uEarthEnergy;
            float earthHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
            float earthNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
                return mix(mix(mix(earthHash(i),earthHash(i+vec3(1,0,0)),f.x),
                    mix(earthHash(i+vec3(0,1,0)),earthHash(i+vec3(1,1,0)),f.x),f.y),
                    mix(mix(earthHash(i+vec3(0,0,1)),earthHash(i+vec3(1,0,1)),f.x),
                    mix(earthHash(i+vec3(0,1,1)),earthHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
            ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
            #include <color_fragment>
            float grain=earthNoise(vEarth*28.0+vEarthSeed);
            float pockets=earthNoise(vEarth*7.0+vEarthSeed);
            diffuseColor.rgb*=mix(0.40,1.15,grain)*mix(0.48,1.0,smoothstep(0.2,0.65,pockets));
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
            #include <emissivemap_fragment>
            float seam=abs(sin(vEarth.x*6.0+vEarth.y*3.0+earthNoise(vEarth*4.0)*4.0));
            float cracks=(1.0-smoothstep(0.018,0.06,seam))*smoothstep(0.48,0.7,earthNoise(vEarth*8.0));
            totalEmissiveRadiance+=vec3(1.0,0.07,0.003)*cracks*step(0.85,fract(vEarthSeed))*uEarthEnergy;
        `);
    };
    material.customProgramCacheKey = () => 'fighting-earth-v1';
    return material;
}
