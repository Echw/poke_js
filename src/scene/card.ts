
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';


export function createCardGeometry() {
    const geometry = new RoundedBoxGeometry(0.7, 1, 0.12, 2, 0.04);
    geometry.scale(1, 1, 0.02 / 0.12);
    return geometry;

}