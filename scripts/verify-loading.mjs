import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launch, isolate } from './ice-test-fixture.mjs';
import { parseSmokeClip } from '../src/effects/smokeClipFormat.ts';

const production = process.argv.includes('--production');
const base = process.env.LOADING_QA_URL || `http://127.0.0.1:${production ? 5175 : 5173}`;
const out = process.env.LOADING_QA_DIR || path.join(os.tmpdir(), 'poke-loading-qa');
await mkdir(out, { recursive: true });
const report = { production, profiles: [], scenarios: [], errors: [] };
const browser = await launch();
const types = ['psychic','electric','grass','fire','water','ice','fighting','poison','ground','flying','bug','rock','ghost','dragon','dark','steel','fairy','normal'];
const bin = url => /\/(?:ice|fighting|ground|poison)-(?:desktop|mobile)[^/]*\.bin$/.test(url);
const ready = page => page.waitForFunction(() => document.querySelector('#startup-loader').hidden, null, { timeout: 120000 });

async function open(width, options = {}) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage(); await isolate(page);
    const requests = [], api = [];
    page.on('request', request => { if (bin(request.url())) requests.push(request.url()); });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /THREE|GLSL|WebGL.*(?:error|INVALID)/i.test(message.text())) report.errors.push(message.text()); });
    await page.route('https://api.tcgdex.net/**', route => {
        api.push(route.request().url());
        const query = new URL(route.request().url()).searchParams.get('name');
        const id = query || route.request().url().split('/').pop();
        const card = { id, name: id, image: `/textures/eevee-preview.webp?card=${id}`, dexId: [133], types: ['Colorless'] };
        return route.fulfill({ json: query ? [card] : card });
    });
    if (options.noCache) await page.route('**/smokeReplayWorker-*.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `Object.defineProperty(self,'caches',{value:{open(){return Promise.reject(new Error('Storage denied'))}}});\n${await response.text()}` });
    });
    let fail = Boolean(options.fail);
    if (options.fail || options.slow) await page.route(/\/ice-(desktop|mobile)[^/]*\.bin$/, async route => {
        if (fail) return route.abort();
        if (options.slow) await new Promise(resolve => setTimeout(resolve, 500));
        return route.continue();
    });
    const started = performance.now();
    await page.goto(`${base}/${production ? '' : '?reveal=fighting'}`, { waitUntil: 'domcontentloaded' });
    return { page, context, requests, api, started, recover: () => { fail = false; } };
}

try {
    for (const width of [1280, 600]) {
        const test = await open(width), { page, context, requests, api } = test;
        await ready(page);
        assert.equal(requests.length, 4, 'Four unique source files, including shared Fighting/Ghost');
        assert.ok(requests.every(url => url.includes(width < 700 ? '-mobile' : '-desktop')));
        const profile = { width, startupMs: performance.now() - test.started, requests: [...requests], starts: [] };
        if (!production) {
            await page.evaluate(() => window.__pokemonReveal.stop());
            const initial = await page.evaluate(() => window.__pokemonReveal.debug.snapshot());
            assert.equal(initial.prepared.length, 18);
            for (const type of types) {
                const result = await page.evaluate(async type => {
                    const scene = window.__pokemonReveal, started = performance.now();
                    await scene.play(type); scene.stop();
                    const startMs = performance.now() - started;
                    const first = scene.debug.snapshot();
                    await scene.debug.seek(2.8);
                    const decoded = scene.debug.snapshot().mist?.replay?.decodedSegments;
                    const replayStart = performance.now();
                    await scene.play(type); scene.stop();
                    const second = scene.debug.snapshot();
                    return { type, startMs, repeatMs: performance.now() - replayStart,
                        beforeDecoded: decoded, afterDecoded: second.mist?.replay?.decodedSegments,
                        programs: second.programs, preparedMs: first.preparationMs[type] };
                }, type);
                assert.equal(result.beforeDecoded, result.afterDecoded, `${type}: restart must reuse pinned startup segments`);
                assert.equal(result.programs, initial.programs, `${type}: no new shader programs after startup`);
                profile.starts.push(result);
                await page.evaluate(async () => window.__pokemonReveal.debug.seek(1.4));
                await page.screenshot({ path: path.join(out, `loading-${width}-${type}.png`) });
            }
            for (const type of ['ice','fighting','ghost','ground','poison']) {
                const source = type === 'ghost' ? 'fighting' : type;
                const file = await readFile(`src/assets/mist-replay/${source}-${width < 700 ? 'mobile' : 'desktop'}.bin`);
                const { header } = parseSmokeClip(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
                await page.evaluate(async type => { await window.__pokemonReveal.play(type); window.__pokemonReveal.stop(); }, type);
                for (const frame of [0, 24, 84, 168, 210]) {
                    const hash = await page.evaluate(async frame => {
                        const debug = window.__pokemonReveal.debug; await debug.seek(frame / 60);
                        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', debug.replayFrameData())), b => b.toString(16).padStart(2,'0')).join('');
                    }, frame);
                    assert.equal(hash, header.profile.chunks[Math.floor(frame / 4)].frames[frame % 4].densitySHA256);
                }
            }
            await page.setViewportSize({ width: width < 700 ? 900 : 600, height: 800 });
            assert.equal(await page.evaluate(() => window.__pokemonReveal.debug.snapshot().mobile), width < 700);
            await page.setViewportSize({ width, height: 800 });
            assert.equal(requests.length, 4, 'Switching/resizing must not fetch more clips');
            await page.evaluate(async () => {
                const scene = window.__pokemonReveal;
                await Promise.all([scene.play('ice'), scene.play('water')]); scene.stop();
            });
            assert.equal(await page.evaluate(() => window.__pokemonReveal.debug.snapshot().effect), 'WaterEffect');
            await page.evaluate(async () => {
                const scene = window.__pokemonReveal; await scene.play('ice'); await scene.debug.seek(1);
                scene.debug.resume(0.2);
                Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            const paused = await page.evaluate(() => window.__pokemonReveal.debug.snapshot().time);
            await page.waitForTimeout(100);
            assert.equal(await page.evaluate(() => window.__pokemonReveal.debug.snapshot().time), paused);
            await page.evaluate(() => {
                Object.defineProperty(document, 'hidden', { configurable: true, value: false });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            await page.waitForFunction(time => window.__pokemonReveal.debug.snapshot().time > time, paused);
            await page.evaluate(() => window.__pokemonReveal.stop());
            // Exercise actual search events, including texture eviction and repeated-query hits.
            for (let index = 0; index < 50; index++) {
                await page.locator('#pokemon-name').fill(`card${index}`);
                await page.locator('button[type=submit]').click();
                await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
                assert.equal(await page.locator('#summon-status').textContent(), '');
                await page.evaluate(() => window.__pokemonReveal.stop());
            }
            const apiBefore = api.length;
            await page.locator('#pokemon-name').fill('CARD49');
            await page.locator('button[type=submit]').click();
            await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
            assert.equal(api.length, apiBefore, 'Normalized repeated search uses the application cache');
            const last = await page.evaluate(() => window.__pokemonReveal.debug.snapshot());
            assert.ok(last.cardCache.entries <= 8 && last.cardCache.bytes <= 64 * 1024 * 1024);
            assert.equal(last.memory.geometries, initial.memory.geometries);
            assert.ok(last.memory.textures <= initial.memory.textures + 8);
            await page.evaluate(() => { window.__pokemonReveal.dispose(); window.__pokemonReveal.dispose(); });
            await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().contextLost);
            const disposed = await page.evaluate(() => window.__pokemonReveal.debug.snapshot());
            assert.equal(disposed.memory.geometries, 0); assert.equal(disposed.cardCache.entries, 0);
            // Renderer-internal transmission targets are released by context loss, not reflected in info.memory.
            assert.equal(disposed.contextLost, true);
        } else {
            requests.length = 0;
            await page.reload(); await ready(page);
            assert.equal(requests.length, 0, 'Reload reads validated disk cache');
            await page.evaluate(async () => {
                const cache = await caches.open('poke-replay-v1'), keys = await cache.keys();
                await cache.put(keys[0], new Response('corrupt'));
                await cache.put('/obsolete-replay.bin', new Response('obsolete'));
            });
            await page.reload(); await ready(page);
            assert.equal(requests.length, 1, 'Only a corrupt entry is fetched again');
            assert.equal(await page.evaluate(async () => (await (await caches.open('poke-replay-v1')).keys()).length), 4);
        }
        report.profiles.push(profile); await context.close();
        console.log(`${production ? 'production' : 'development'} ${width}: passed`);
    }
    const failed = await open(600, { fail: true });
    await failed.page.locator('#startup-retry').waitFor({ state: 'visible', timeout: 120000 });
    assert.equal(await failed.page.locator('#pokemon-search').evaluate(form => form.inert), true);
    await failed.page.screenshot({ path: path.join(out, 'loader-error.png') });
    failed.recover(); await failed.page.locator('#startup-retry').click(); await ready(failed.page);
    await failed.context.close(); report.scenarios.push('failed replay / retry');
    const slow = await open(600, { slow: true, reduced: true });
    await slow.page.screenshot({ path: path.join(out, 'loader-mobile.png') });
    await ready(slow.page);
    if (!production) {
        const snapshot = await slow.page.evaluate(() => window.__pokemonReveal.debug.snapshot());
        assert.equal(snapshot.running, false); assert.equal(snapshot.time, snapshot.duration);
    }
    await slow.context.close(); report.scenarios.push('slow download / reduced motion');
    if (production) {
        const noCache = await open(600, { noCache: true }); await ready(noCache.page);
        assert.equal(noCache.requests.length, 4);
        await noCache.context.close(); report.scenarios.push('storage unavailable');
    } else {
        // Ordinary startup does not use the card API, even when it is unavailable.
        const missingCard = await open(600);
        await ready(missingCard.page);
        await missingCard.page.unroute('https://api.tcgdex.net/**');
        await missingCard.page.route('https://api.tcgdex.net/**', route => route.abort());
        await missingCard.page.goto(base); await ready(missingCard.page);
        assert.equal(await missingCard.page.locator('#pokemon-search').evaluate(form => form.inert), false);
        assert.equal(await missingCard.page.locator('#summon-status').textContent(), '');
        assert.equal(await missingCard.page.evaluate(() => window.__pokemonReveal.debug.snapshot().idle), true);
        await missingCard.context.close(); report.scenarios.push('idle startup does not depend on card API');
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
} finally {
    await writeFile(path.join(out, `loading-${production ? 'production' : 'development'}.json`), JSON.stringify(report, null, 2));
    await browser.close();
}
console.log(`Loading verification passed: ${out}`);
