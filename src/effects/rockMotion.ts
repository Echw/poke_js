import { MathUtils, type Vector3, type Quaternion } from 'three';

// Positions stay in the open bowl's front half, clear of the hinged lid.
export const ROCK_POSES = [
    { base: [-0.27, -0.13, 0.39], target: [-0.58, 0.47, 0.34], size: [0.30, 0.27, 0.28], birth: 0.42, axis: [0.3, 0.8, -0.4] },
    { base: [0.24, -0.12, 0.29], target: [0.60, 0.84, 0.18], size: [0.43, 0.50, 0.37], birth: 0.51, axis: [-0.4, 0.6, 0.3] },
    { base: [0.34, -0.15, 0.59], target: [0.63, 0.32, 0.41], size: [0.31, 0.22, 0.27], birth: 0.60, axis: [0.7, -0.4, 0.2] },
    { base: [-0.10, -0.16, 0.69], target: [-0.43, 0.20, 0.24], size: [0.17, 0.14, 0.18], birth: 0.68, axis: [-0.3, 0.4, 0.8] },
] as const;

/** One direct lift to a fixed destination, followed only by a vertical landing. */
export function rockPosition(out: Vector3, index: number, time: number): void {
    const p = ROCK_POSES[index];
    const lift = MathUtils.smootherstep(time, p.birth, p.birth + 0.62);
    const landing = MathUtils.smootherstep(time, 2.00 + index * 0.045, 2.91 + index * 0.045);
    for (let axis = 0; axis < 3; axis++) {
        out.setComponent(axis, p.base[axis] + (p.target[axis] - p.base[axis]) * lift);
    }
    out.y += ((index === 1 ? -0.70 : -0.60) - p.target[1]) * landing;
    const tension = MathUtils.smootherstep(time, 0.12, 0.22) * (1 - MathUtils.smootherstep(time, p.birth - 0.10, p.birth));
    out.y += Math.sin(time * 67 + index * 2) * 0.004 * tension;
}

/** Slow individual axes reveal thickness without orbiting or synchronized bobbing. */
export function rockRotation(out: Quaternion, axis: Vector3, index: number, time: number): void {
    const p = ROCK_POSES[index];
    const age = MathUtils.clamp(time - p.birth, 0, 2.6 - p.birth);
    out.setFromAxisAngle(axis, index * 0.71 + age * (0.30 + index * 0.065));
}
