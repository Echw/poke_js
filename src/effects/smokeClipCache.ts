import { parseSmokeClip } from './smokeClipFormat';

const CACHE_NAME = 'poke-replay-v1';
const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(
    await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');

/** Validate before use or persistence, including every compressed segment. */
async function validate(buffer: ArrayBuffer) {
    const parsed = parseSmokeClip(buffer);
    const { headerSHA256, ...metadata } = parsed.header;
    if (await digest(new TextEncoder().encode(JSON.stringify(metadata))) !== headerSHA256)
        throw new Error('Smoke header checksum mismatch');
    for (const chunk of parsed.header.profile.chunks) {
        if (await digest(new Uint8Array(buffer, parsed.payloadOffset + chunk.offset, chunk.bytes)) !== chunk.sha256)
            throw new Error('Smoke segment checksum mismatch');
    }
    return parsed;
}

/** Disk cache is optional. Development URLs are mutable, so only production uses it. */
export async function loadSmokeClip(url: string) {
    let cache: Cache | undefined;
    if (import.meta.env.PROD) {
        try { cache = await caches.open(CACHE_NAME); } catch { /* Private mode / quota: use the network. */ }
    }
    if (cache) {
        try {
            const response = await cache.match(url);
            if (response) {
                const buffer = await response.arrayBuffer();
                return { buffer, ...await validate(buffer), cacheHit: true };
            }
        } catch { await cache.delete(url).catch(() => false); }
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Smoke clip HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const parsed = await validate(buffer);
    // Construct a separate response after validation; no unbounded tee of the download stream.
    if (cache) await cache.put(url, new Response(buffer)).catch(() => {});
    return { buffer, ...parsed, cacheHit: false };
}

/** Remove only this application's obsolete replay entries, after successful preparation. */
export async function pruneSmokeCache(currentUrls: string[]): Promise<void> {
    if (!import.meta.env.PROD) return;
    try {
        const keep = new Set(currentUrls.map(url => new URL(url, location.href).href));
        const cache = await caches.open(CACHE_NAME);
        for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
        for (const name of await caches.keys()) if (name.startsWith('poke-replay-') && name !== CACHE_NAME) await caches.delete(name);
    } catch { /* Persistence must never gate startup. */ }
}
