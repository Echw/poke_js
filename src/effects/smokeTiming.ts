/** Reveal seconds and original fixed-step simulation seconds are distinct clocks. */
export const SMOKE_DT = 1 / 60;
export const SMOKE_DURATION = 3.5;
export const SMOKE_FRAMES = 211;
export const SMOKE_TIMING_ID = 'ice-3.5-opening-0.8-ramp-0.2-v1';

/** Preserve opening collisions, then integrate a smooth acceleration to 51/26. */
export function smokeSourceTime(time: number): number {
    const t = Math.min(SMOKE_DURATION, Math.max(0, time));
    if (t <= 0.8) return t;
    const speed = 51 / 26;
    if (t < 1) {
        const u = (t - 0.8) / 0.2;
        return t + (speed - 1) * 0.2 * (u ** 3 - 0.5 * u ** 4);
    }
    return 1 + (speed - 1) * 0.1 + (t - 1) * speed;
}

export function smokeFrame(time: number): number {
    if (!Number.isFinite(time)) throw new Error('Smoke time must be finite');
    return Math.min(SMOKE_FRAMES - 1, Math.max(0, Math.floor(time / SMOKE_DT + 0.00001)));
}

export function smokeSourceFrame(frame: number): number {
    return Math.min(360, Math.floor(smokeSourceTime(frame * SMOKE_DT) / SMOKE_DT + 0.00001));
}
