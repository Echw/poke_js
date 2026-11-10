import { gzipSync, gunzipSync } from 'node:zlib';
import { DataUtils } from 'three';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CLIP_MAGIC, DELTA_CLIP_MAGIC, CLIP_PREFIX_BYTES, parseSmokeClip, restoreSmokeChunk } from '../src/effects/smokeClipFormat.ts';
import { REPLAY_CONTRACT } from '../src/effects/smokeReplayTypes.ts';

const bytesOf = values => Buffer.from(values.buffer, values.byteOffset, values.byteLength);
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');

/** Offline prediction only: the first frame remains absolute and segments stay independent. */
export function predictSmokeChunk(packed, encoding, count) {
    if (encoding.predictor === 'delta-u8') {
        const stride = packed.length / count;
        for (let i = packed.length - 1; i >= stride; i--) packed[i] = (packed[i] - packed[i - stride]) & 255;
    } else {
        const words = new Uint32Array(packed.buffer, packed.byteOffset, packed.length / 4), stride = words.length / count;
        for (let i = words.length - 1; i >= stride; i--) words[i] ^= words[i - stride];
    }
}

/** Serialize a validated versioned container; the replay contract and source hashes are unchanged. */
export function serializeSmokeClip(header, payload) {
    header.id = sha(JSON.stringify({ sources: header.sources, timing: header.timingId, bits: header.encoding.bits,
        predictor: header.encoding.predictor, name: header.name, segments: header.profile.chunks.map(c => c.sha256) })).slice(0, 20);
    delete header.headerSHA256;
    header.headerSHA256 = sha(JSON.stringify(header));
    const json = Buffer.from(JSON.stringify(header)), prefix = Buffer.alloc(CLIP_PREFIX_BYTES);
    prefix.write(header.encoding.predictor === 'delta-u8' ? DELTA_CLIP_MAGIC : CLIP_MAGIC);
    prefix.writeUInt32LE(json.length, 8); prefix.writeUInt32LE(header.profile.totalBytes, 12);
    const buffer = Buffer.concat([prefix, json, ...payload]);
    parseSmokeClip(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    return buffer;
}

/** Streaming offline builder: at most four original frames plus compressed segments. */
export function createSmokeClip(metadata, name, layout, bits = 8) {
    assert.ok([8,12,16].includes(bits));
    const { profiles, profile, encoding, ...common } = metadata;
    const header = { ...common, contract: REPLAY_CONTRACT, id: '', name,
        encoding: { bits, ...(bits === 8 ? { predictor: 'delta-u8' } : {}), maxDensity: 3, palette: bits === 16 ? [] : Array.from({length:2**bits},(_,i)=>DataUtils.toHalfFloat(3*(i/(2**bits-1))**2)) },
        profile: { ...layout, chunks: [], totalBytes: 0 } };
    const lut = bits === 16 ? null : Uint16Array.from({length:65536},(_,i)=> {
        if(i===0x8000)return 0;
        const value=DataUtils.fromHalfFloat(i);
        return Number.isFinite(value)&&value>=0?Math.round(Math.sqrt(Math.min(3,value)/3)*(2**bits-1)):0;
    });
    const payload = [];let frameIndex = 0;
    return {
        add(frames) {
            assert.ok(frames.length>0&&frames.length<=4);const pixels=layout.width*layout.height;
            const packedStride=pixels*bits/8, packed=Buffer.allocUnsafe(packedStride*frames.length), restored=[];
            for(let f=0;f<frames.length;f++) {
                const input=new Uint16Array(frames[f].buffer,frames[f].byteOffset,pixels), out=packed.subarray(f*packedStride,(f+1)*packedStride);
                if(bits===16)bytesOf(input).copy(out);
                else if(bits===8)for(let i=0;i<pixels;i++)out[i]=lut[input[i]];
                else for(let i=0,j=0;i<pixels;i+=2){const a=lut[input[i]],b=lut[input[i+1]];out[j++]=a&255;out[j++]=(a>>8)|((b&15)<<4);out[j++]=b>>4;}
                const decoded=bits===16?input:Uint16Array.from(input,value=>header.encoding.palette[lut[value]]);
                restored.push({densitySHA256:sha(bytesOf(decoded)),sourceSHA256:sha(bytesOf(input)),sourceFrame:metadata.sourceFrameIndices[frameIndex+f]});
            }
            predictSmokeChunk(packed, header.encoding, frames.length);
            const compressed=gzipSync(packed,{level:9});
            const chunk={offset:header.profile.totalBytes,first:frameIndex,count:frames.length,bytes:compressed.length,
                rawBytes:pixels*2*frames.length,packedBytes:packed.length,sha256:sha(compressed),frames:restored};
            const raw=gunzipSync(compressed), decoded=restoreSmokeChunk(raw,header,chunk);
            for(let f=0;f<frames.length;f++)assert.equal(sha(bytesOf(decoded.subarray(f*pixels,(f+1)*pixels))),restored[f].densitySHA256);
            header.profile.chunks.push(chunk);header.profile.totalBytes+=compressed.length;payload.push(compressed);frameIndex+=frames.length;
        },
        finish() {
            assert.equal(frameIndex,header.frames);
            const buffer=serializeSmokeClip(header,payload);
            return {buffer,header};
        },
    };
}
