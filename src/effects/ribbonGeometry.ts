import * as THREE from 'three';

/** Grass's indexed strips; zero positions are displaced by each effect's vertex shader. */
export function makeRibbons(count: number, strands: number, segments = 96, across = 4): THREE.BufferGeometry {
    const verticesPerRibbon = (segments + 1) * (across + 1);
    const bands = count * strands;
    const positions = new Float32Array(bands * verticesPerRibbon * 3);
    const times = new Float32Array(bands * verticesPerRibbon);
    const sides = new Float32Array(bands * verticesPerRibbon);
    const ribbons = new Float32Array(bands * verticesPerRibbon);
    const strandIds = new Float32Array(bands * verticesPerRibbon);
    const indices: number[] = [];
    for (let band = 0; band < bands; band++) {
        const ribbon = Math.floor(band / strands);
        const strand = band % strands;
        for (let segment = 0; segment <= segments; segment++) {
            for (let side = 0; side <= across; side++) {
                const index = band * verticesPerRibbon + segment * (across + 1) + side;
                times[index] = segment / segments;
                sides[index] = side / across * 2 - 1;
                ribbons[index] = ribbon;
                strandIds[index] = strand;
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
    geometry.setAttribute('aRibbon', new THREE.BufferAttribute(ribbons, 1));
    geometry.setAttribute('aStrand', new THREE.BufferAttribute(strandIds, 1));
    geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.7, 0), 3.0);
    return geometry;
}
