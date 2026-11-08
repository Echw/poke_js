import { SMOKE_PRESET } from './smokeReplayTypes.ts';
import { SMOKE_TIMING_ID, smokeSourceFrame, smokeSourceTime } from './smokeTiming.ts';

export type SmokeVariant = 'ice' | 'fighting' | 'poison' | 'ground';

/** Shared by the solver, replay validator and offline exporter. Ice remains the default. */
export function smokeProfile(variant: SmokeVariant = 'ice') {
    return variant === 'ground' ? GROUND_SMOKE : variant === 'poison' ? POISON_SMOKE : variant === 'fighting' ? FIGHTING_SMOKE : ICE_SMOKE;
}

const ICE_SMOKE = {
    variant: 'ice' as const, domainMin: [-1.7, -2.4, -1.7], domainSize: 3.4,
    preset: SMOKE_PRESET, timingId: SMOKE_TIMING_ID,
    sourceFrame: smokeSourceFrame, sourceTime: smokeSourceTime,
};
const FIGHTING_SMOKE = {
    variant: 'fighting' as const, domainMin: [-1.7, -1.0, -1.7], domainSize: 3.4,
    preset: { ...SMOKE_PRESET, emission: 6.5, density: 1.7, fallSpeed: 1.35,
        spread: 2.4, turbulence: 2.2, fadeTime: 1.1, adhesion: 0.05, curlStrength: 1.8 },
    timingId: 'fighting-3.5-opening-0.8-realtime-v1',
    sourceFrame: (frame: number) => Math.min(210, Math.max(0, frame)),
    sourceTime: (time: number) => Math.min(3.5, Math.max(0, time)),
};

/** Two brief releases share one source; all emission ends before card materialization. */
export function fightingImpulse(time: number): number {
    return Math.exp(-(((time - 0.64) / 0.095) ** 2)) * 0.7
        + Math.exp(-(((time - 1.02) / 0.13) ** 2));
}

/** Two lateral plumes rise out of the bowl, leaving the card corridor clear. */
const POISON_SMOKE = {
    variant: 'poison' as const, domainMin: [-1.7, -1.0, -1.7], domainSize: 3.4,
    preset: { ...SMOKE_PRESET, emission: 9.0, density: 1.65, fallSpeed: 0.90,
        spread: 1.30, turbulence: 1.20, fadeTime: 0.9, adhesion: 0.05, curlStrength: 1.45 },
    timingId: 'poison-3.5-opening-0.8-realtime-v1',
    sourceFrame: (frame: number) => Math.min(210, Math.max(0, frame)),
    sourceTime: (time: number) => Math.min(3.5, Math.max(0, time)),
};

/** Localized, short soil releases; low buoyancy and fast dissipation. */
const GROUND_SMOKE = {
    variant: 'ground' as const, domainMin: [-1.7, -1.0, -1.7], domainSize: 3.4,
    preset: { ...SMOKE_PRESET, emission: 28.0, density: 1.15, fallSpeed: 0.18,
        spread: 1.8, turbulence: 0.85, fadeTime: 0.32, adhesion: 0.03, curlStrength: 0.65 },
    timingId: 'ground-3.5-opening-0.8-events-v1',
    sourceFrame: (frame: number) => Math.min(210, Math.max(0, frame)),
    sourceTime: (time: number) => Math.min(3.5, Math.max(0, time)),
};
