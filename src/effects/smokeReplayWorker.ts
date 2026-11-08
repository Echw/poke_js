import { parseSmokeClip, restoreSmokeChunk } from './smokeClipFormat';
import type { SmokeReplayManifest } from './smokeReplayTypes';

const scope = self as unknown as {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
};
let queue = Promise.resolve();
let clip: ArrayBuffer | undefined;
let header: SmokeReplayManifest;
let payloadOffset = 0;
const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

// The worker owns one compressed clip; only current/next restored FP16 segments
// are transferred to the host. A serial queue bounds transient inflate memory.
scope.onmessage = event => {
    const request = event.data;
    queue = queue.then(async () => {
        try {
            if (request.kind === 'init') {
                const start = performance.now(), response = await fetch(request.url);
                if (!response.ok) throw new Error(`Smoke clip HTTP ${response.status}`);
                clip = await response.arrayBuffer();
                ({ header, payloadOffset } = parseSmokeClip(clip));
                const { headerSHA256, ...metadata } = header;
                if (await digest(new TextEncoder().encode(JSON.stringify(metadata))) !== headerSHA256) throw new Error('Smoke header checksum mismatch');
                for (const chunk of header.profile.chunks) {
                    const bytes = new Uint8Array(clip, payloadOffset + chunk.offset, chunk.bytes);
                    if (await digest(bytes) !== chunk.sha256) throw new Error('Smoke segment checksum mismatch');
                }
                scope.postMessage({ id: request.id, header, bytes: clip.byteLength, transfers: [performance.now() - start] });
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
