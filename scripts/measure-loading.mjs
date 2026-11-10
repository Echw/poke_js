import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { launch, isolate } from './ice-test-fixture.mjs';

// Run baseline/candidate separately, with no other GPU or compression jobs running.
const production = process.argv.includes('--production');
const base = process.env.LOADING_QA_URL || `http://127.0.0.1:${production ? 5175 : 5173}`;
const out = process.env.LOADING_QA_DIR || path.join(os.tmpdir(), 'poke-loading-measurement');
await mkdir(out, { recursive: true });
const browser = await launch();
const report = { production, browser: browser.version(), profiles: [] };
try {
    for (const width of [1280, 600]) {
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        const page = await context.newPage(); await isolate(page);
        for (const cache of ['cold', 'warm']) {
            const clips = [];
            const requests = [], active = new Set();
            let peakDownloads = 0;
            const onRequest = request => {
                requests.push(request.url());
                if (/\/(ice|fighting|poison|ground)-(desktop|mobile)[^/]*\.bin$/.test(request.url())) {
                    clips.push(request.url()); active.add(request); peakDownloads = Math.max(peakDownloads, active.size);
                }
            };
            const onSettled = request => active.delete(request);
            page.on('request', onRequest);
            page.on('requestfinished', onSettled); page.on('requestfailed', onSettled);
            const started = performance.now();
            await page.goto(base);
            await page.waitForFunction(() => document.querySelector('#startup-loader').hidden, null, { timeout: 180000 });
            const result = { width, cache, startupMs: performance.now() - started, clips, peakDownloads, effects: [] };
            assert.ok(peakDownloads <= 2, 'At most two heavy network transfers');
            assert.equal(requests.filter(url => url.endsWith('.glb')).length, 1, 'One GLB request for parsing and hashing');
            for (const texture of ['rock-color.webp', 'rock-surface.webp', 'steel-brushed-detail.webp'])
                assert.equal(requests.filter(url => url.endsWith(texture)).length, 1, `One shared ${texture} request`);
            if (!production) {
                result.initial = await page.evaluate(() => window.__pokemonReveal.debug.snapshot());
                for (const type of ['ice', 'fighting', 'ghost', 'poison', 'ground']) {
                    await page.evaluate(() => { window.loadingBufferProbe = { events: 0, active: false }; });
                    const start = performance.now();
                    await page.evaluate(type => window.__pokemonReveal.play(type), type);
                    await page.waitForFunction(() => {
                        const state = window.__pokemonReveal.debug.snapshot(), probe = window.loadingBufferProbe;
                        if (state.buffering && !probe.active) probe.events++;
                        probe.active = state.buffering;
                        return state.time >= 3.5;
                    });
                    const snapshot = await page.evaluate(() => window.__pokemonReveal.debug.snapshot());
                    const bufferEvents = await page.evaluate(() => window.loadingBufferProbe.events);
                    result.effects.push({ type, playbackMs: performance.now() - start, bufferEvents, replay: snapshot.mist.replay });
                }
            }
            page.off('request', onRequest);
            page.off('requestfinished', onSettled); page.off('requestfailed', onSettled);
            report.profiles.push(result);
            console.log(`${width} ${cache}: ${result.startupMs.toFixed(0)} ms, ${clips.length} clip requests`);
        }
        await context.close();
    }
} finally {
    await browser.close();
    await writeFile(path.join(out, `measurement-${production ? 'production' : 'development'}.json`), JSON.stringify(report, null, 2));
}
