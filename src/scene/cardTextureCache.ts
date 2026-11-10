import * as THREE from 'three';

const MAX_TEXTURES = 8;
const MAX_BYTES = 64 * 1024 * 1024;

/** Scene-owned LRU. The displayed texture is pinned until the caller swaps it. */
export class CardTextureCache {
    private entries = new Map<string, { texture: THREE.Texture; bytes: number }>();
    private pending = new Map<string, Promise<THREE.Texture>>();
    private disposed = false;
    private pinned?: THREE.Texture;
    private leases = new Map<string, number>();
    private readonly load: (url: string) => Promise<THREE.Texture>;

    constructor(load: (url: string) => Promise<THREE.Texture>) { this.load = load; }

    async acquire(url: string): Promise<{ texture: THREE.Texture; release: () => void }> {
        this.leases.set(url, (this.leases.get(url) ?? 0) + 1);
        const release = () => {
            const count = (this.leases.get(url) ?? 1) - 1;
            if (count) this.leases.set(url, count); else this.leases.delete(url);
            this.trim();
        };
        try { return { texture: await this.get(url), release }; }
        catch (error) { release(); throw error; }
    }

    private async get(url: string): Promise<THREE.Texture> {
        if (this.disposed) throw new Error('Card cache disposed');
        const entry = this.entries.get(url);
        if (entry) {
            this.entries.delete(url); this.entries.set(url, entry);
            return entry.texture;
        }
        const pending = this.pending.get(url);
        if (pending) return pending;
        const promise = this.load(url).then(texture => {
            if (this.disposed) { texture.dispose(); throw new Error('Card cache disposed'); }
            const image = texture.image as { width: number; height: number };
            const bytes = Math.ceil(image.width * image.height * 4 * 4 / 3);
            if (bytes > MAX_BYTES) { texture.dispose(); throw new Error('Card image exceeds texture memory budget'); }
            this.entries.set(url, { texture, bytes });
            return texture;
        });
        this.pending.set(url, promise);
        try { return await promise; } finally { this.pending.delete(url); }
    }

    pin(texture: THREE.Texture): void { this.pinned = texture; this.trim(); }
    trim(): void {
        let bytes = this.bytes;
        for (const [url, entry] of this.entries) {
            if (this.entries.size <= MAX_TEXTURES && bytes <= MAX_BYTES) break;
            if (entry.texture === this.pinned || this.leases.has(url)) continue;
            this.entries.delete(url); bytes -= entry.bytes; entry.texture.dispose();
        }
    }
    private get bytes() { return [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0); }
    snapshot() { return { entries: this.entries.size, bytes: this.bytes, pending: this.pending.size }; }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const entry of this.entries.values()) entry.texture.dispose();
        this.entries.clear(); this.pending.clear(); this.pinned = undefined;
    }
}
