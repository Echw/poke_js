import { restoreSmokeChunk } from './smokeClipFormat';
import { loadSmokeClip } from './smokeClipCache';
import type { SmokeReplayManifest } from './smokeReplayTypes';

const scope = self as unknown as {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
};
let queue = Promise.resolve();
let clip: ArrayBuffer | undefined;
let header: SmokeReplayManifest;
let payloadOffset = 0;

// The worker owns one compressed clip; only current/next restored FP16 segments
// are transferred to the host. A serial queue bounds transient inflate memory.
scope.onmessage = event => {
    const request = event.data;
    queue = queue.then(async () => {
        try {
            if (request.kind === 'init') {
                const start = performance.now(), loaded = await loadSmokeClip(request.url);
                clip = loaded.buffer; header = loaded.header; payloadOffset = loaded.payloadOffset;
                scope.postMessage({ id: request.id, header, bytes: clip.byteLength, cacheHit: loaded.cacheHit, transfers: [performance.now() - start] });
                return;
            }
            if (!clip) throw new Error('Smoke clip is not prepared');
            const chunk = header.profile.chunks[request.segment];
            if (!chunk) throw new Error('Invalid smoke segment index');
            const decodeStart = performance.now();
            const compressed = new Uint8Array(clip, payloadOffset + chunk.offset, chunk.bytes);
            const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
            const raw = new Uint8Array(chunk.packedBytes), reader = stream.getReader();
            let offset = 0;
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (offset + value.length > raw.length) throw new Error('Smoke segment overflow');
                raw.set(value, offset); offset += value.length;
            }
            if (offset !== raw.length) throw new Error('Truncated smoke segment');
            const restored = restoreSmokeChunk(raw, header, chunk), buffer = restored.buffer;
            scope.postMessage({ id: request.id, buffer, decodeMs: performance.now() - decodeStart }, [buffer]);
        } catch (error) {
            scope.postMessage({ id: request.id, error: String(error) });
        }
    });
};
