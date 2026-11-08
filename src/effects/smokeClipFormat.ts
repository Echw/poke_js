import { REPLAY_CONTRACT } from './smokeReplayTypes.ts';
import type { ReplayChunk, SmokeReplayManifest } from './smokeReplayTypes';

export const CLIP_MAGIC = 'ICEMIST3';
export const CLIP_PREFIX_BYTES = 16;

/** Container offsets are relative to the payload, following the UTF-8 JSON header. */
export function parseSmokeClip(buffer: ArrayBuffer): { header: SmokeReplayManifest; payloadOffset: number } {
    if (buffer.byteLength < CLIP_PREFIX_BYTES) throw new Error('Truncated smoke clip');
    const prefix = new DataView(buffer);
    if (new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) !== CLIP_MAGIC) throw new Error('Invalid smoke clip signature');
    const size = prefix.getUint32(8, true), payloadSize = prefix.getUint32(12, true);
    if (size < 2 || size > 1024 * 1024 || CLIP_PREFIX_BYTES + size + payloadSize !== buffer.byteLength) throw new Error('Invalid smoke clip length');
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, CLIP_PREFIX_BYTES, size))) as SmokeReplayManifest;
    if (header.contract !== REPLAY_CONTRACT || ![8, 12, 16].includes(header.encoding?.bits)) throw new Error('Unsupported smoke clip encoding');
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

/** Restore XOR first, then expand through an offline FP16 palette; GPU math is unchanged. */
export function restoreSmokeChunk(raw: Uint8Array, header: SmokeReplayManifest, chunk: ReplayChunk): Uint16Array {
    if (raw.byteLength !== chunk.packedBytes || raw.byteOffset % 4 !== 0 || raw.byteLength % 4 !== 0) throw new Error('Invalid decoded smoke segment');
    const words = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), stride = words.length / chunk.count;
    for (let frame = 1; frame < chunk.count; frame++) for (let i = 0; i < stride; i++) words[frame * stride + i]! ^= words[(frame - 1) * stride + i]!;
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
