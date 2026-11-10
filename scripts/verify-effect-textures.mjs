import assert from 'node:assert/strict';
import * as THREE from 'three';
import { acquireEffectTexture, prefetchEffectTextures } from '../src/effects/effectTextures.ts';

const original = THREE.TextureLoader.prototype.loadAsync;
const pending = [];
THREE.TextureLoader.prototype.loadAsync = function(url) {
    return new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
};
try {
    const a = acquireEffectTexture('rockColor'), b = acquireEffectTexture('rockColor');
    assert.equal(pending.length, 1, 'Two materials must share one request');
    const color = new THREE.Texture(); let disposed = 0;
    color.addEventListener('dispose', () => disposed++);
    pending.shift().resolve(color);
    assert.equal(await a.ready, await b.ready);
    assert.equal(color.colorSpace, THREE.SRGBColorSpace);
    assert.equal(color.anisotropy, 4);
    a.release(); a.release(); assert.equal(disposed, 0);
    b.release(); assert.equal(disposed, 1, 'Last owner disposes exactly once');

    const late = acquireEffectTexture('rockSurface');
    const lateTexture = new THREE.Texture(); let lateDisposals = 0;
    lateTexture.addEventListener('dispose', () => lateDisposals++);
    late.release(); pending.shift().resolve(lateTexture);
    await assert.rejects(late.ready, /disposed/);
    assert.equal(lateDisposals, 1);

    const failed = acquireEffectTexture('rockSurface');
    pending.shift().reject(new Error('network failure'));
    await assert.rejects(failed.ready, /network failure/);
    const retry = acquireEffectTexture('rockSurface');
    assert.equal(pending.length, 1, 'Failure must not poison subsequent acquisitions');
    pending.shift().resolve(new THREE.Texture()); await retry.ready;
    failed.release(); retry.release();

    const releasePrefetch = prefetchEffectTextures(true);
    const steel = acquireEffectTexture('steelMobile');
    assert.equal(pending.length, 3);
    while (pending.length) pending.shift().resolve(new THREE.Texture());
    const brush = await steel.ready; let brushDisposals = 0;
    brush.addEventListener('dispose', () => brushDisposals++);
    assert.deepEqual(brush.repeat.toArray(), [2, 1]); assert.equal(brush.anisotropy, 2);
    releasePrefetch(); releasePrefetch(); assert.equal(brushDisposals, 0);
    steel.release(); assert.equal(brushDisposals, 1);
    console.log('Shared texture ownership, failed acquisition, retry, late arrival and sampler settings passed.');
} finally { THREE.TextureLoader.prototype.loadAsync = original; }
