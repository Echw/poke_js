import type { Group } from 'three';

/** A reveal effect owns its GPU resources; the scene owns playback and rendering. */
export interface PokemonRevealEffect {
    readonly root: Group;
    addToTimeline(timeline: gsap.core.Timeline): void;
    update(time: number, viewportHeight: number): void;
    reset(): void;
    finish(): void;
    dispose(): void;
}
