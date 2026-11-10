import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../assets/pokeball.glb?url';

let modelHash: Promise<string> | undefined;

/** Decode and validate the same GLB bytes; do not retain the buffer after parsing/hashing. */
export async function loadPokeball(loader: GLTFLoader) {
    const bytes = fetch(modelUrl, { signal: AbortSignal.timeout(60000) }).then(response => {
        if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
        return response.arrayBuffer();
    });
    modelHash = bytes.then(data => crypto.subtle.digest('SHA-256', data)).then(hash =>
        Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
    void modelHash.catch(() => {});
    return loader.parseAsync(await bytes, new URL('.', new URL(modelUrl, location.href)).href);
}

/** Replay starts only after the scene has loaded its model. */
export function getPokeballHash(): Promise<string> {
    if (!modelHash) return Promise.reject(new Error('Pokeball must be loaded before replay validation'));
    return modelHash;
}
