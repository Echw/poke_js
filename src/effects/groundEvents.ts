/** Ball-local authoring data shared by pillars, debris and the smoke solver. */
export const GROUND_FLOOR = -0.11;
export const GROUND_GRAVITY = 4.3;
export const GROUND_PILLARS = [
    { x: -0.53, z: -0.25, height: 1.08, width: 0.36, lean: -0.24, leanZ: -0.08, yaw: -0.24, birth: 0.40, settle: 0.87, retract: 2.24, hidden: 3.02 },
    { x: 0.54, z: -0.28, height: 0.96, width: 0.34, lean: 0.23, leanZ: -0.16, yaw: 0.31, birth: 0.48, settle: 0.95, retract: 2.30, hidden: 3.05 },
    { x: -0.56, z: 0.28, height: 0.60, width: 0.32, lean: -0.38, leanZ: 0.12, yaw: 0.55, birth: 0.56, settle: 1.03, retract: 2.15, hidden: 2.87 },
    { x: 0.56, z: 0.27, height: 0.54, width: 0.33, lean: 0.36, leanZ: 0.18, yaw: -0.56, birth: 0.62, settle: 1.09, retract: 2.19, hidden: 2.93 },
    { x: 0.67, z: -0.04, height: 0.40, width: 0.24, lean: 0.20, leanZ: -0.20, yaw: 0.83, birth: 0.45, settle: 0.92, retract: 2.21, hidden: 2.96 },
] as const;

export function groundSmooth(lo: number, hi: number, time: number): number {
    const t = Math.max(0, Math.min(1, (time - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
}

/** Rigid translation, with a short pressure pause and 2.5% settling after the thrust. */
export function groundExtension(time: number, p: typeof GROUND_PILLARS[number]): number {
    const rise = groundSmooth(p.birth, p.settle - 0.09, time) * 1.025
        - groundSmooth(p.settle - 0.09, p.settle, time) * 0.025;
    return rise * (1 - groundSmooth(p.retract, p.hidden, time));
}

export const GROUND_EVENTS = GROUND_PILLARS.flatMap((p, pillar) => {
    const axisLength = Math.hypot(p.lean, 1, p.leanZ);
    const edge = (time: number, height: number) => {
        const along = height - (1 - groundExtension(time, p)) * (p.height + 0.08);
        return { x: p.x + p.lean / axisLength * along, y: GROUND_FLOOR + along / axisLength,
            z: p.z + p.leanZ / axisLength * along };
    };
    return [
    { pillar, kind: 'breakthrough' as const, time: p.birth + 0.06, x: p.x, y: GROUND_FLOOR + 0.035, z: p.z, strength: 1 },
    { pillar, kind: 'settle' as const, time: p.settle, ...edge(p.settle, p.height * 0.85), strength: 0.24 },
    { pillar, kind: 'retract' as const, time: p.retract + 0.28, ...edge(p.retract + 0.28, p.height * 0.85), strength: 0.48 },
    ];
});

/** Compile the same immutable event table into GLSL; no per-frame allocation or callbacks. */
export const groundDustGLSL = `
    float groundDust(vec3 q, float time) {
        float dust=0.0;
        ${GROUND_EVENTS.map(e => `dust += ${e.strength.toFixed(4)} * exp(-dot(q-vec3(${e.x.toFixed(4)},${e.y.toFixed(4)},${e.z.toFixed(4)}),q-vec3(${e.x.toFixed(4)},${e.y.toFixed(4)},${e.z.toFixed(4)}))*38.0) * exp(-pow((time-${e.time.toFixed(4)})/0.065,2.0));`).join('\n')}
        return dust;
    }
`;
