import { REPLAY_CONTRACT } from './smokeReplayTypes.ts';
import type { ReplayChunk, SmokeReplayManifest } from './smokeReplayTypes';

export const CLIP_MAGIC = 'ICEMIST3';
export const DELTA_CLIP_MAGIC = 'ICEMIST4';
export const CLIP_PREFIX_BYTES = 16;

/** Container offsets are relative to the payload, following the UTF-8 JSON header. */
export function parseSmokeClip(buffer: ArrayBuffer): { header: SmokeReplayManifest; payloadOffset: number } {
    if (buffer.byteLength < CLIP_PREFIX_BYTES) throw new Error('Truncated smoke clip');
    const prefix = new DataView(buffer);
    const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 8));
    if (magic !== CLIP_MAGIC && magic !== DELTA_CLIP_MAGIC) throw new Error('Invalid smoke clip signature');
    const size = prefix.getUint32(8, true), payloadSize = prefix.getUint32(12, true);
    if (size < 2 || size > 1024 * 1024 || CLIP_PREFIX_BYTES + size + payloadSize !== buffer.byteLength) throw new Error('Invalid smoke clip length');
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, CLIP_PREFIX_BYTES, size))) as SmokeReplayManifest;
    if (header.contract !== REPLAY_CONTRACT || ![8, 12, 16].includes(header.encoding?.bits)) throw new Error('Unsupported smoke clip encoding');
    if (magic === DELTA_CLIP_MAGIC ? header.encoding.bits !== 8 || header.encoding.predictor !== 'delta-u8'
        : header.encoding.predictor !== undefined) throw new Error('Unsupported smoke predictor');
    const p = header.profile, bits = header.encoding.bits;
    if (!p || !Array.isArray(p.chunks) || p.width <= 0 || p.height <= 0 || p.width * p.height > 4 * 1024 * 1024) throw new Error('Invalid smoke atlas');
    if (bits !== 16 && (header.encoding.palette.length !== 2 ** bits || header.encoding.palette[0] !== 0
        || header.encoding.palette.some(v => !Number.isInteger(v) || v < 0 || v > 0x7bff))) throw new Error('Invalid smoke palette');
    let offset = 0;
    for (const chunk of p.chunks) {
        if (chunk.offset !== offset || chunk.bytes <= 0 || chunk.offset + chunk.bytes > payloadSize
            || chunk.rawBytes !== p.width * p.height * 2 * chunk.count
            || chunk.packedBytes !== p.width * p.height * bits / 8 * chunk.count) throw new Error('Invalid smoke segment');
        offset += chunk.bytes;
    }
    if (offset !== payloadSize) throw new Error('Smoke payload size mismatch');
    return { header, payloadOffset: CLIP_PREFIX_BYTES + size };
}

/** Reverse the container predictor in place, preserving the exact packed palette indices. */
export function restorePackedSmokeChunk(raw: Uint8Array, header: SmokeReplayManifest, chunk: ReplayChunk): Uint8Array {
    if (raw.byteLength !== chunk.packedBytes || raw.byteOffset % 4 !== 0 || raw.byteLength % 4 !== 0) throw new Error('Invalid decoded smoke segment');
    if (header.encoding.predictor === 'delta-u8') {
        const stride = raw.length / chunk.count;
        for (let i = stride; i < raw.length; i++) raw[i] = (raw[i]! + raw[i - stride]!) & 255;
    } else {
        const words = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), stride = words.length / chunk.count;
        for (let i = stride; i < words.length; i++) words[i]! ^= words[i - stride]!;
    }
    return raw;
}

/** Restore legacy XOR or v4 byte deltas, then expand the unchanged FP16 palette. */
export function restoreSmokeChunk(raw: Uint8Array, header: SmokeReplayManifest, chunk: ReplayChunk): Uint16Array {
    if (header.encoding.predictor === 'delta-u8') {
        if (raw.byteLength !== chunk.packedBytes || raw.byteOffset % 4 !== 0 || (raw.length / chunk.count) % 4 !== 0)
            throw new Error('Invalid decoded smoke segment');
        const output = new Uint16Array(chunk.rawBytes / 2), palette = new Uint16Array(header.encoding.palette);
        const words = new Uint32Array(raw.buffer, raw.byteOffset, raw.length / 4), stride = words.length / chunk.count;
        for (let i = 0; i < stride * 4; i++) output[i] = palette[raw[i]!]!;
        for (let i = stride; i < words.length; i++) {
            const delta = words[i]!, previous = words[i - stride]!;
            // Two pairs of separated byte lanes prevent carries between adjacent palette indices.
            const low = ((delta & 0x00ff00ff) + (previous & 0x00ff00ff)) & 0x00ff00ff;
            const high = (((delta >>> 8) & 0x00ff00ff) + ((previous >>> 8) & 0x00ff00ff)) & 0x00ff00ff;
            const value = low | (high << 8);
            words[i] = value;
            const pixel = i * 4;
            output[pixel] = palette[value & 255]!;
            output[pixel + 1] = palette[(value >>> 8) & 255]!;
            output[pixel + 2] = palette[(value >>> 16) & 255]!;
            output[pixel + 3] = palette[value >>> 24]!;
        }
        return output;
    }
    restorePackedSmokeChunk(raw, header, chunk);
    if (header.encoding.bits === 16) return new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    const output = new Uint16Array(chunk.rawBytes / 2), palette = new Uint16Array(header.encoding.palette);
    if (header.encoding.bits === 8) {
        for (let i = 0; i < raw.length; i++) output[i] = palette[raw[i]!]!;
    } else {
        for (let i = 0, j = 0; i < raw.length; i += 3) {
            output[j++] = palette[raw[i]! | ((raw[i + 1]! & 15) << 8)]!;
            output[j++] = palette[(raw[i + 1]! >> 4) | (raw[i + 2]! << 4)]!;
        }
    }
    return output;
}
