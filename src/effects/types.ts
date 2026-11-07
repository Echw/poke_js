import type { Color, Group, Vector3 } from 'three';

export type RevealType = 'psychic' | 'electric' | 'grass' | 'fire' | 'water';

/** A reveal effect owns its GPU resources; the scene owns playback and rendering. */
export interface PokemonRevealEffect {
    readonly root: Group;
    readonly fillLightColor: Color;
    readonly fillLightPosition: Vector3;
    readonly fillLightIntensity: number;
    setActive(active: boolean): void;
    addToTimeline(timeline: gsap.core.Timeline): void;
    update(time: number, viewportHeight: number): void;
    reset(): void;
    finish(): void;
    dispose(): void;
}
