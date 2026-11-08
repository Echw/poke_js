import type { Vector3 } from 'three';

export type FireflyRoute = Readonly<{
    phase: number;
    driftPhase: number;
    radius: number;
    height: number;
    speed: number;
    rise: number;
    spread: number;
}>;

const fraction = (value: number) => value - Math.floor(value);

/** Seed a dispersed volume once; no shared lanes, waypoint times or repeated stops. */
export function makeFireflyRoute(index: number, mobile = false): FireflyRoute {
    return {
        phase: index * 2.39996323,
        driftPhase: fraction(index * 0.754877666) * Math.PI * 2,
        radius: 0.20 + fraction(index * 0.569840291) * 0.88,
        height: index < 3 ? 0.03 : 0.02 + fraction(index * 0.414213562) * 0.95,
        speed: (index % 2 === 0 ? 1 : -1) * (0.45 + fraction(index * 0.324717957) * 0.40),
        rise: 0.09 + fraction(index * 0.732050808) * 0.13,
        spread: mobile ? 0.84 : 1,
    };
}

/** Continuous analytic flight: time is never snapped, segmented, eased to a stop or clamped. */
export function sampleFirefly(route: FireflyRoute, time: number, target: Vector3): void {
    const angle = route.phase + route.speed * time + 0.12 * Math.sin(time * 0.9 + route.driftPhase);
    const radius = (route.radius + 0.20 * (1 - Math.exp(-time * 0.55))
        + 0.045 * Math.sin(time * 1.3 + route.driftPhase)) * route.spread;
    target.set(
        Math.cos(angle) * radius,
        route.height + route.rise * time + 0.12 * Math.sin(time * 1.25 + route.driftPhase),
        0.45 + Math.sin(angle) * radius * 0.55 + 0.07 * Math.sin(time * 1.1 + route.phase),
    );
}
