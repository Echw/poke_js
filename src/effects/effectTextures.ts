import * as THREE from 'three';

type TextureId = 'rockColor' | 'rockSurface' | 'steelDesktop' | 'steelMobile';
export interface EffectTextureLease { ready: Promise<THREE.Texture>; release(): void }
interface Entry { references: number; ready: Promise<THREE.Texture>; texture?: THREE.Texture }
const entries = new Map<TextureId, Entry>();
const urls: Record<TextureId, string> = {
    rockColor: '/textures/ground/rock-color.webp',
    rockSurface: '/textures/ground/rock-surface.webp',
    steelDesktop: '/textures/steel-brushed-detail.webp',
    steelMobile: '/textures/steel-brushed-detail.webp',
};

/** Ground, Rock and startup share immutable samplers; the last lease owns disposal. */
export function acquireEffectTexture(id: TextureId): EffectTextureLease {
    let entry = entries.get(id);
    if (!entry) {
        const created: Entry = { references: 0, ready: new THREE.TextureLoader().loadAsync(urls[id]).then(texture => {
            if (created.references === 0) { texture.dispose(); throw new Error('Texture owner disposed'); }
            texture.colorSpace = id === 'rockColor' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = id === 'steelMobile' ? 2 : 4;
            if (id.startsWith('steel')) { texture.name = 'SteelBrushedDetail'; texture.repeat.set(2, 1); }
            created.texture = texture;
            return texture;
        }).catch(error => {
            if (entries.get(id) === created) entries.delete(id);
            throw error;
        }) };
        // A prefetch can fail before its effect is constructed. Its consumer still receives the rejection.
        void created.ready.catch(() => {});
        entries.set(id, created); entry = created;
    }
    const owned = entry;
    owned.references++;
    let released = false;
    return { ready: owned.ready, release() {
        if (released) return;
        released = true;
        if (--owned.references === 0) {
            if (entries.get(id) === owned) entries.delete(id);
            owned.texture?.dispose();
        }
    } };
}

/** Start image requests now; keep successful resources available until effects acquire their leases. */
export function prefetchEffectTextures(mobile: boolean): () => void {
    const leases = (['rockColor', 'rockSurface', mobile ? 'steelMobile' : 'steelDesktop'] as TextureId[]).map(acquireEffectTexture);
    for (const lease of leases) void lease.ready.catch(() => lease.release());
    return () => leases.forEach(lease => lease.release());
}
