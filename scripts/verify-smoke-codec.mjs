import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DataUtils } from 'three';
import { parseSmokeClip, restoreSmokeChunk, restorePackedSmokeChunk } from '../src/effects/smokeClipFormat.ts';
import { sha, createSmokeClip, predictSmokeChunk, serializeSmokeClip } from './smoke-clip-codec.mjs';

// Small compatibility fixtures cover old 8/12/16-bit paths and modulo-256 wraparound.
const fixtureFrames = [0, 1, 2, 3].map(frame => Uint16Array.from(
    [0, 3, 0.01, 2, 1, 0, 3, 0.4], (value, i) => DataUtils.toHalfFloat((frame + i) % 2 ? value : 3 - value)));
for (const bits of [8, 12, 16]) {
    const builder = createSmokeClip({ frames: 4, sourceFrameIndices: [0, 1, 2, 3], sources: {}, timingId: 'fixture' },
        'desktop', { width: 4, height: 2 }, bits);
    builder.add(fixtureFrames);
    const { buffer, header } = builder.finish();
    const parsed = parseSmokeClip(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length));
    const chunk = header.profile.chunks[0];
    const compressed = buffer.subarray(parsed.payloadOffset);
    const expected = restoreSmokeChunk(gunzipSync(compressed), header, chunk);
    if (bits === 8) {
        const legacy = structuredClone(header); delete legacy.encoding.predictor;
        const packed = restorePackedSmokeChunk(gunzipSync(compressed), header, chunk);
        predictSmokeChunk(packed, legacy.encoding, chunk.count);
        const oldCompressed = gzipSync(packed, { level: 6 });
        legacy.profile.chunks[0].bytes = legacy.profile.totalBytes = oldCompressed.length;
        legacy.profile.chunks[0].sha256 = sha(oldCompressed);
        const oldFile = serializeSmokeClip(legacy, [oldCompressed]);
        parseSmokeClip(oldFile.buffer.slice(oldFile.byteOffset, oldFile.byteOffset + oldFile.length));
        assert.deepEqual(restoreSmokeChunk(gunzipSync(oldCompressed), legacy, legacy.profile.chunks[0]), expected);
        const wrongMagic = Buffer.from(buffer); wrongMagic.write('ICEMIST3');
        assert.throws(() => parseSmokeClip(wrongMagic.buffer.slice(wrongMagic.byteOffset, wrongMagic.byteOffset + wrongMagic.length)), /predictor/);
    }
    for (let frame = 0; frame < 4; frame++)
        assert.equal(sha(new Uint8Array(expected.buffer, frame * 16, 16)), chunk.frames[frame].densitySHA256);
}

const current = process.argv[2] || 'src/assets/mist-replay';
const reference = process.argv[3];
let frames = 0;
for (const name of (await readdir(current)).filter(name => name.endsWith('.bin'))) {
    let referenceHeader;
    for (const directory of [reference, current].filter(Boolean)) {
        const file = await readFile(`${directory}/${name}`);
        const { header, payloadOffset } = parseSmokeClip(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
        const { headerSHA256, ...metadata } = header;
        assert.equal(sha(JSON.stringify(metadata)), headerSHA256);
        if (referenceHeader) {
            assert.deepEqual(header.encoding.palette, referenceHeader.encoding.palette);
            for (const key of ['sources', 'modelSHA256', 'preset', 'opening', 'timingId', 'sourceFrameIndices', 'dt', 'frames', 'chunkFrames'])
                assert.deepEqual(header[key], referenceHeader[key], key);
            assert.deepEqual(header.profile.chunks.map(c => c.frames), referenceHeader.profile.chunks.map(c => c.frames));
        }
        for (const chunk of header.profile.chunks) {
            const compressed = file.subarray(payloadOffset + chunk.offset, payloadOffset + chunk.offset + chunk.bytes);
            assert.equal(sha(compressed), chunk.sha256);
            const restored = restoreSmokeChunk(gunzipSync(compressed), header, chunk);
            const pixels = header.profile.width * header.profile.height;
            for (let f = 0; f < chunk.count; f++) {
                const values = restored.subarray(f * pixels, (f + 1) * pixels);
                assert.equal(sha(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)), chunk.frames[f].densitySHA256);
                frames++;
            }
        }
        referenceHeader = header;
    }
}
console.log(`Verified ${frames} decoded frame hashes${reference ? ' across legacy and candidate containers' : ''}.`);
