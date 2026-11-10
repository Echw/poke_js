import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseSmokeClip, restoreSmokeChunk, restorePackedSmokeChunk } from '../src/effects/smokeClipFormat.ts';
import { predictSmokeChunk, serializeSmokeClip, sha } from './smoke-clip-codec.mjs';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error('Usage: node scripts/transcode-smoke-clips.mjs <input directory> <output directory>');
await mkdir(output, { recursive: true });
for (const name of (await readdir(input)).filter(name => name.endsWith('.bin')).sort()) {
    const original = await readFile(path.join(input, name));
    const { header, payloadOffset } = parseSmokeClip(original.buffer.slice(original.byteOffset, original.byteOffset + original.length));
    assert.equal(header.encoding.bits, 8, 'Transcode current 8-bit palette indices; never requantize density');
    const { headerSHA256, ...metadata } = header;
    assert.equal(sha(JSON.stringify(metadata)), headerSHA256);
    const next = structuredClone(header);
    next.encoding.predictor = 'delta-u8';
    next.profile.chunks = []; next.profile.totalBytes = 0;
    const payload = [];
    let frames = 0;
    for (const chunk of header.profile.chunks) {
        const compressed = original.subarray(payloadOffset + chunk.offset, payloadOffset + chunk.offset + chunk.bytes);
        assert.equal(sha(compressed), chunk.sha256);
        const absolute = restorePackedSmokeChunk(gunzipSync(compressed), header, chunk);
        const predicted = Buffer.from(absolute);
        predictSmokeChunk(predicted, next.encoding, chunk.count);
        const encoded = gzipSync(predicted, { level: 9 });
        const segment = { ...chunk, offset: next.profile.totalBytes, bytes: encoded.length, sha256: sha(encoded) };
        assert.deepEqual(restorePackedSmokeChunk(gunzipSync(encoded), next, segment), absolute);
        const restored = restoreSmokeChunk(gunzipSync(encoded), next, segment);
        const pixels = header.profile.width * header.profile.height;
        for (let frame = 0; frame < chunk.count; frame++) {
            const values = restored.subarray(frame * pixels, (frame + 1) * pixels);
            assert.equal(sha(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)), chunk.frames[frame].densitySHA256);
            frames++;
        }
        next.profile.chunks.push(segment); next.profile.totalBytes += encoded.length; payload.push(encoded);
    }
    const buffer = serializeSmokeClip(next, payload);
    const destination = path.join(output, name);
    await writeFile(`${destination}.tmp`, buffer);
    await rename(`${destination}.tmp`, destination);
    console.log(JSON.stringify({ name, before: original.length, after: buffer.length, verifiedFrames: frames }));
}
