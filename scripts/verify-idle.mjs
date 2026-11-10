import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launch, isolate } from './ice-test-fixture.mjs';

const production = process.argv.includes('--production');
const base = process.env.IDLE_QA_URL || `http://127.0.0.1:${production ? 5175 : 5173}`;
const out = process.env.IDLE_QA_DIR || path.join(os.tmpdir(), 'poke-idle-qa');
await mkdir(out, { recursive: true });
const browser = await launch();
const report = { production, profiles: [], errors: [] };
const ready = page => page.waitForFunction(() => document.querySelector('#startup-loader').hidden, null, { timeout: 120000 });
const capture = page => page.locator('canvas').screenshot({ style: '.summon-form { visibility: hidden !important; }' });
const snapshot = page => page.evaluate(() => window.__pokemonReveal.debug.snapshot());

async function assertIdle(page) {
    if (production) return;
    const state = await snapshot(page);
    assert.equal(state.idle, true);
    assert.equal(state.running, false);
    assert.equal(state.buffering, false);
    assert.equal(state.cardVisible, false);
    assert.equal(state.lidAngle, 0);
    assert.equal(state.revealLight, 0);
    assert.equal(state.prepared.length, 18);
}

try {
    for (const width of [1280, 600]) for (const reduced of [false, true]) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
        const page = await context.newPage(); await isolate(page);
        const api = [], clips = [];
        page.on('pageerror', error => report.errors.push(error.message));
        page.on('request', request => {
            if (request.url().startsWith('https://api.tcgdex.net/')) api.push(request.url());
            if (/\/(ice|fighting|ground|poison)-(desktop|mobile)[^/]*\.bin$/.test(request.url())) clips.push(request.url());
        });
        await page.route('https://api.tcgdex.net/**', route => {
            const url = new URL(route.request().url()), query = url.searchParams.get('name');
            const name = query || url.pathname.split('/').pop();
            if (name === 'missing') return route.fulfill({ json: [] });
            if (name === 'network-error') return route.abort();
            const card = { id: name, name: name === 'Machop' ? 'Machop' : 'Eevee',
                image: name === 'bad-image' ? '/textures/missing-test.webp' : `/textures/eevee-preview.webp?search=${name}`,
                dexId: [name === 'Machop' ? 66 : 133], types: ['Colorless'] };
            return route.fulfill({ json: query ? [card] : card });
        });
        await page.route('**/textures/missing-test.webp', route => route.fulfill({ status: 404, body: 'missing' }));
        await page.route('**/textures/eevee-preview.webp?search=Eevee', async route => {
            await new Promise(resolve => setTimeout(resolve, 250)); await route.continue();
        });
        await page.goto(base); await ready(page); await assertIdle(page);
        assert.equal(api.length, 0, 'Ordinary startup must not request a card');
        assert.equal(clips.length, 4);
        assert.equal(await page.locator('#summon-status').textContent(), '');
        const initialImage = await capture(page);
        await page.screenshot({ path: path.join(out, `idle-${production ? 'prod' : 'dev'}-${width}-${reduced}.png`) });
        const before = production ? undefined : await snapshot(page);
        await page.waitForTimeout(150);
        if (!production) assert.equal((await snapshot(page)).renderedFrames, before.renderedFrames, 'Idle has no continuous render loop');

        for (const name of ['missing', 'network-error', 'bad-image']) {
            await page.locator('#pokemon-name').fill(name);
            await page.locator('button[type=submit]').click();
            await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
            await assertIdle(page);
            assert.notEqual(await page.locator('#summon-status').textContent(), '');
            assert.ok((await capture(page)).equals(initialImage), 'Failed search leaves the same closed ball');
        }

        await page.setViewportSize({ width: width + 20, height: 780 });
        await assertIdle(page);
        await page.evaluate(() => {
            for (const hidden of [true, false]) {
                Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
                document.dispatchEvent(new Event('visibilitychange'));
            }
        });
        await page.setViewportSize({ width, height: 800 }); await assertIdle(page);
        if (!production) {
            await page.evaluate(() => window.__pokemonReveal.setCardImage('/textures/eevee-preview.webp'));
            await assertIdle(page);
        }
        assert.ok((await capture(page)).equals(initialImage), 'Resize, visibility and texture loading preserve idle');
        await page.locator('#pokemon-name').fill('Eevee');
        await page.locator('button[type=submit]').click();
        await assertIdle(page); // Image is deliberately delayed; opening must wait for it.
        await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
        assert.equal(await page.locator('#summon-status').textContent(), '');
        if (!production) {
            await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time > 0.1);
            const state = await snapshot(page);
            assert.equal(state.idle, false); assert.equal(state.effect, 'NormalEffect');
            assert.ok(state.lidAngle < 0);
            assert.deepEqual(state.preparationMs, before.preparationMs, 'Prepared effects were not recreated');
            if (reduced) { assert.equal(state.time, state.duration); assert.equal(state.running, false); }
            else await page.evaluate(() => window.__pokemonReveal.debug.seek(1.4));
        } else await page.waitForTimeout(reduced ? 100 : 1000);
        assert.ok(!(await capture(page)).equals(initialImage), 'Successful search opens the ball');
        await page.screenshot({ path: path.join(out, `searched-${production ? 'prod' : 'dev'}-${width}-${reduced}.png`) });
        if (!production) {
            await page.evaluate(() => { window.__pokemonReveal.showIdle(); window.__pokemonReveal.showIdle(); });
            await assertIdle(page);
            assert.ok((await capture(page)).equals(initialImage), 'Idle restores the original look after a reveal');
        }
        await page.locator('#pokemon-name').fill('Machop');
        await page.locator('button[type=submit]').click();
        await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
        if (!production) assert.equal((await snapshot(page)).effect, 'FightingEffect');
        assert.equal(clips.length, 4, 'Searches reuse already loaded effects');
        report.profiles.push({ width, reduced, passed: true });
        await context.close();
        console.log(`${production ? 'production' : 'development'} ${width}, reduced=${reduced}: passed`);
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
} finally {
    await writeFile(path.join(out, `idle-${production ? 'production' : 'development'}.json`), JSON.stringify(report, null, 2));
    await browser.close();
}
