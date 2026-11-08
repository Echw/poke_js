import type { Vector3, Quaternion } from 'three';

/** Shared rigid ballistic motion; callers own preallocated outputs and visibility. */
export function earthPosition(out: Vector3, base: Vector3, velocity: Vector3, age: number, gravity: number): void {
    out.copy(base).addScaledVector(velocity, age);
    out.y -= 0.5 * gravity * age * age;
}

export function earthRotation(out: Quaternion, scratch: Quaternion, rotation: Quaternion, axis: Vector3, age: number, spin: number): void {
    scratch.setFromAxisAngle(axis, Math.max(0, age) * spin);
    out.copy(rotation).premultiply(scratch);
}
