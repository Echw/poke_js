import type * as THREE from 'three';

export const SMOKE_PRESET = {
    emission: 1, density: 1, fallSpeed: 1.8, spread: 0.3, turbulence: 2.6,
    fadeTime: 1.6, adhesion: 0.35, curlStrength: 1.1, steps: 128,
};
export const REPLAY_CONTRACT = 'pokemon-ice-clip-v3';
export interface SmokeField {
    readonly densityResolution: number;
    readonly densityTiles: number;
    readonly domainMin: THREE.Vector3;
    readonly domainSize: number;
    readonly texture: THREE.Texture;
    readonly version: number;
}
export interface ReplayChunk {
    offset: number; first: number; count: number; bytes: number; rawBytes: number; packedBytes: number; sha256: string;
    frames: { densitySHA256: string; sourceSHA256: string; sourceFrame: number }[];
}
export interface ReplayProfile {
    resolution: number; tiles: number; width: number; height: number;
    velocityResolution: number; channels: 1; lightSteps: number;
    chunks: ReplayChunk[]; totalBytes: number;
}
export interface SmokeReplayManifest {
    variant?: 'ice' | 'fighting' | 'poison' | 'ground';
    headerSHA256: string;
    contract: string; id: string; dt: number; frames: number; chunkFrames: number;
    duration: number; timingId: string; sourceFrameIndices: number[];
    domainMin: number[]; domainSize: number;
    preset: typeof SMOKE_PRESET; opening: { duration: number; lidDegrees: number; bodyDegrees: number };
    modelSHA256: string; sources: Record<string, string>;
    name: 'desktop' | 'mobile';
    encoding: { bits: 8 | 12 | 16; maxDensity: number; palette: number[]; predictor?: 'delta-u8' };
    profile: ReplayProfile;
}
