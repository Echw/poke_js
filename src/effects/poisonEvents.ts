/** Absolute-time events in Ball-local space. Rendering and diagnostics share these poses. */
export type PoisonEvent = {
    x: number; z: number; radius: number; start: number; grow: number; pop: number;
    gas: boolean; seed: number; mobile: boolean;
};
export const POISON_LEVEL = -0.14;
export const POISON_GRAVITY = 3.4;
export const POISON_RUPTURE = 0.18;
export const POISON_DOME_DELAY = 0.06;
export const POISON_DROP_LIFE = 0.85;
export const POISON_EVENT_CAPACITY = 16;
export const POISON_LIMITS = {
    desktop: { bubbles: 8, drops: 48, dropsPerEvent: 6 },
    mobile: { bubbles: 5, drops: 28, dropsPerEvent: 4 },
} as const;
export const POISON_EVENTS: readonly PoisonEvent[] = [
    { x: -0.40, z: 0.25, radius: 0.20, start: 0.08, grow: 0.34, pop: 0.71, gas: false, seed: 1.3, mobile: true },
    { x: 0.44, z: 0.08, radius: 0.16, start: 0.16, grow: 0.28, pop: 1.05, gas: true, seed: 3.1, mobile: true },
    { x: -0.44, z: -0.12, radius: 0.17, start: 0.28, grow: 0.30, pop: 1.25, gas: true, seed: 4.7, mobile: true },
    { x: 0.03, z: 0.40, radius: 0.26, start: 0.38, grow: 0.42, pop: 1.12, gas: false, seed: 6.2, mobile: true },
    { x: 0.46, z: 0.24, radius: 0.21, start: 0.50, grow: 0.33, pop: 1.37, gas: false, seed: 8.4, mobile: false },
    { x: -0.48, z: 0.17, radius: 0.13, start: 0.56, grow: 0.24, pop: 1.48, gas: true, seed: 10.1, mobile: false },
    { x: 0.42, z: -0.18, radius: 0.14, start: 0.69, grow: 0.24, pop: 1.62, gas: true, seed: 11.7, mobile: true },
    { x: -0.26, z: -0.20, radius: 0.23, start: 0.83, grow: 0.31, pop: 1.51, gas: false, seed: 13.4, mobile: false },
    { x: -0.48, z: 0.12, radius: 0.18, start: 1.03, grow: 0.24, pop: 1.91, gas: true, seed: 15.1, mobile: true },
    { x: 0.50, z: 0.14, radius: 0.12, start: 1.18, grow: 0.22, pop: 2.02, gas: true, seed: 17.2, mobile: false },
    { x: 0.51, z: -0.09, radius: 0.19, start: 1.44, grow: 0.25, pop: 2.03, gas: false, seed: 19.1, mobile: true },
    { x: -0.53, z: -0.08, radius: 0.14, start: 1.55, grow: 0.23, pop: 2.38, gas: true, seed: 21.4, mobile: true },
    { x: 0.51, z: -0.12, radius: 0.12, start: 1.75, grow: 0.22, pop: 2.53, gas: true, seed: 23.1, mobile: true },
    { x: -0.52, z: 0.06, radius: 0.13, start: 1.98, grow: 0.24, pop: 2.57, gas: false, seed: 25.2, mobile: false },
    { x: 0.54, z: 0.04, radius: 0.10, start: 2.28, grow: 0.22, pop: 2.83, gas: false, seed: 27.1, mobile: true },
    { x: -0.51, z: 0.02, radius: 0.08, start: 2.68, grow: 0.22, pop: 3.07, gas: false, seed: 29.2, mobile: true },
];

export function smooth(lo: number, hi: number, value: number): number {
    const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
}

/** Surface envelope is shared with GLSL; event-local movement replaces travelling rings. */
export function poisonHeight(x: number, z: number, time: number, events: readonly PoisonEvent[]): number {
    const strength = smooth(0, 0.30, time) * (1 - smooth(2.65, 3.5, time));
    let h = 0.005 * Math.sin(x * 17 + time * 2.3) * Math.sin(z * 13 - time * 1.7);
    for (const e of events) {
        const release = e.gas ? e.start + e.grow + 0.06 : e.pop;
        const r = Math.hypot(x - e.x, z - e.z), age = time - release;
        const rise = smooth(e.start, e.start + e.grow, time) * (1 - smooth(release, release + 0.12, time));
        h += e.radius * 0.16 * rise * Math.exp(-Math.pow(r / (e.radius * 0.85), 2));
        if (age >= 0 && age < 0.5) {
            h -= 0.035 * Math.exp(-Math.pow(r / (e.radius * 0.8), 2)) * Math.sin(Math.min(age / 0.22, 1) * Math.PI) * (1 - smooth(0.18, 0.4, age));
            h += 0.014 * Math.sin(r * 32 - age * 24) * Math.exp(-age * 9 - r * r * 18) * smooth(0, 0.05, age);
        }
    }
    return POISON_LEVEL + h * strength * (1 - smooth(0.72, 0.88, Math.hypot(x, z - 0.05)));
}

export function bubblePose(e: PoisonEvent, time: number, events: readonly PoisonEvent[],
    pose = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0, stretch: 1, rupture: 0, visible: false }) {
    const grow = smooth(e.start + POISON_DOME_DELAY, e.start + e.grow, time);
    const release = e.start + e.grow;
    const flight = e.pop - release;
    const detach = e.gas ? Math.max(0, (time - release) / flight) : 0;
    const direction = e.x < 0 ? -1 : 1;
    const drift = 0.90 * direction;
    const lift = e.radius * 1.3 + 0.70;
    const radius = e.radius * Math.max(0.001, grow);
    const stretch = 1 + 0.12 * smooth(e.pop - 0.12, e.pop, time);
    // Lift first, then fan out. Continue through rupture so released drops inherit motion.
    pose.x = e.x + drift * detach * detach * (2 - detach);
    pose.y = poisonHeight(e.x, e.z, detach > 0 ? release : time, events) - radius * 0.24 + detach * lift;
    pose.z = e.z - 0.10 * detach;
    pose.vx = detach > 0 ? drift * (4 * detach - 3 * detach * detach) / flight : 0;
    pose.vy = detach > 0 ? lift / flight : 0;
    pose.vz = detach > 0 ? -0.10 / flight : 0;
    pose.radius = radius; pose.stretch = stretch;
    pose.rupture = smooth(e.pop, e.pop + POISON_RUPTURE, time);
    pose.visible = time > e.start + POISON_DOME_DELAY && time < e.pop + POISON_RUPTURE;
    return pose;
}

// Scratch storage is only used synchronously; update() performs no per-drop allocations.
const dropOrigin = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0, stretch: 1, rupture: 0, visible: false };

/** A released liquid drop uses a fixed birth position and gravity, never gas buoyancy. */
export function dropPose(e: PoisonEvent, index: number, time: number, events: readonly PoisonEvent[],
    pose = { birth: 0, age: 0, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0, size: 0, visible: false }) {
    const birth = e.pop + 0.045 + index * 0.008, age = time - birth;
    const angle = e.seed + index * 2.399963;
    const speed = 0.68 + 0.18 * Math.sin(index * 7 + e.seed);
    const origin = bubblePose(e, birth, events, dropOrigin);
    const vx = Math.cos(angle) * speed + (e.gas ? origin.vx : 0);
    const vz = Math.sin(angle) * speed + (e.gas ? origin.vz : 0);
    const vy = (e.gas ? 0.28 + origin.vy : 0.82) + 0.20 * Math.sin(index * 3 + e.seed);
    // Sample the wet crown's top edge at this drop's actual release time.
    const crownPhase = (birth - e.pop) / 0.26;
    const crownRadius = e.radius * (0.68 + crownPhase * 0.8) + 0.025 + 0.025 * crownPhase;
    const crownLift = Math.sin(crownPhase * Math.PI) * (0.04 + 0.18 * (0.5 + 0.5 * Math.sin(angle * 4 + e.seed)) ** 2);
    const originRadius = e.gas ? e.radius * 0.8 : crownRadius;
    const originY = e.gas
        ? origin.y + e.radius * 0.6 * origin.stretch
        : poisonHeight(e.x, e.z, birth, events) + crownLift;
    pose.birth = birth; pose.age = age; pose.vx = vx; pose.vy = vy - POISON_GRAVITY * age; pose.vz = vz;
    pose.x = (e.gas ? origin.x : e.x) + Math.cos(angle) * originRadius + vx * age;
    pose.y = originY + vy * age - POISON_GRAVITY * age * age * 0.5;
    pose.z = (e.gas ? origin.z : e.z) + Math.sin(angle) * originRadius + vz * age;
    pose.size = 0.016 + 0.011 * (0.5 + 0.5 * Math.sin(e.seed + index * 8));
    const landed = pose.vy < 0 && Math.hypot(pose.x, pose.z - 0.05) < 0.85
        && pose.y <= poisonHeight(pose.x, pose.z, time, events);
    pose.visible = age >= 0 && age < POISON_DROP_LIFE && !landed && pose.y > POISON_LEVEL - 0.12 && Math.abs(pose.x) < 1.80;
    return pose;
}
