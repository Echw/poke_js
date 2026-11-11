import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';
import { revealTypeForCard } from '../src/data/revealType.ts';

const out = process.env.DARK_QA_DIR || path.join(os.tmpdir(), 'dark-reveal-qa');
const base = process.env.DARK_QA_URL || 'http://127.0.0.1:5177';
const card = { id: 'neo2-13', name: 'Umbreon', image: 'https://assets.tcgdex.net/en/neo/neo2/13', types: ['Darkness'], dexId: [197] };
const artwork = await readFile('public/textures/umbreon-preview.webp');
await mkdir(out, { recursive: true });
const report = { passed: false, errors: [], profiles: [], scenarios: [] };
const browser = await launch();

// Compare real framebuffer pixels. On a black reference, wine matter must remain visible.
async function difference(page, on, off, region) {
    return page.evaluate(async ({ on, off, region }) => {
        const decode = async data => {
            const image = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
            const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0); image.close(); return ctx.getImageData(0, 0, canvas.width, canvas.height);
        };
        const a = await decode(on), b = await decode(off);
        let changed = 0, crimson = 0, wine = 0, energy = 0;
        for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
            if (region && (x < region.x || x > region.x + region.width || y < region.y || y > region.y + region.height)) continue;
            const i = (y * a.width + x) * 4;
            const delta = Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i + c] - b.data[i + c])));
            energy += delta;
            if (delta < 8) continue;
            changed++;
            const [r, g, blue] = a.data.subarray(i, i + 3);
            if (r > g * 1.6 && r > blue * 1.2) crimson++;
            if (r > 18 && r < 145 && g < r * 0.6 && blue < r) wine++;
        }
        return { changed, crimson, wine, energy };
    }, { on: on.toString('base64'), off: off.toString('base64'), region });
}

async function open(width, height, reduced = false) {
    const context = await browser.newContext({ viewport: { width, height },
        isMobile: width < 700, hasTouch: width < 700, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage(); await isolate(page);
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('CONTEXT_LOST')) report.errors.push(message.text()); });
    await page.route('https://api.tcgdex.net/**', route => route.fulfill({ json: route.request().url().includes('?') ? [card] : card }));
    await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: artwork }));
    await page.goto(`${base}/?reveal=dark`);
    await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 60000 });
    return page;
}

const setCurrents = (page, visible) => page.evaluate(visible => {
    for (const name of ['DarkShadowCurrents', 'DarkCrimsonEdges', 'DarkMotes'])
        window.__pokemonReveal.debug.model.getObjectByName(name).visible = visible;
}, visible);

try {
    for (const [name, dex] of [['Umbreon', 197], ['Murkrow', 198], ['Darkrai', 491], ['Hisuian Qwilfish', 211]])
        for (const dexId of [[dex], []]) assert.equal(revealTypeForCard({ ...card, name, dexId }), 'dark');
    for (const [profile, width, height] of [['desktop', 1200, 900], ['mobile', 390, 844]]) {
        const page = await open(width, height);
        await page.evaluate(() => window.__pokemonReveal.debug.setBlackBackground(true));
        await seek(page, 1.2);
        const initial = await state(page);
        assert.equal(initial.effect, 'DarkEffect'); assert.equal(initial.mist, undefined);
        const on = await page.screenshot({ path: path.join(out, `${profile}-03-black.png`), scale: 'css' });
        await setCurrents(page, false); await seek(page, 1.2);
        const off = await page.screenshot({ scale: 'css' });
        const aura = await difference(page, on, off);
        assert.ok(aura.changed > width * height * 0.006, 'Shadow streams are clearly visible on black');
        assert.ok(aura.crimson > aura.changed * 0.6, 'Wine/crimson palette dominates');
        assert.ok(aura.wine > aura.changed * 0.4, 'Dark wine matter remains between bright folds');
        await setCurrents(page, true);
        const frames = [];
        for (const [stage, time] of [[1, 0.3], [2, 0.7], [3, 1.2], [4, 1.95], [5, 2.6], [6, 3.5]]) {
            await seek(page, time);
            frames.push(await page.screenshot({ path: path.join(out, `${profile}-0${stage}.png`), scale: 'css' }));
        }
        await seek(page, 1.2);
        const repeat = await difference(page, await page.screenshot({ scale: 'css' }), on);
        assert.ok(repeat.changed < width * height * 0.0001, `Reverse seek reproduces the frame: ${JSON.stringify(repeat)}`);
        await seek(page, 1.3); const next = await page.screenshot({ scale: 'css' });
        const motion = await difference(page, on, next);
        assert.ok(motion.changed > width * height * 0.001, 'Shadow structure flows between frames');

        // At stage 05 the illustration center must be independent of the fading currents.
        await seek(page, 2.6); const imageOn = await page.screenshot({ scale: 'css' });
        const cardRegion = await page.evaluate(() => {
            // The camera is private; these bounds lie inside the illustration at both supported framings.
            return { x: innerWidth * 0.475, y: innerHeight * 0.44, width: innerWidth * 0.05, height: innerHeight * 0.09 };
        });
        await setCurrents(page, false); await seek(page, 2.6);
        const illustration = await difference(page, imageOn, await page.screenshot({ scale: 'css' }), cardRegion);
        assert.equal(illustration.changed, 0, 'No smoke layer covers the revealed illustration center');
        await setCurrents(page, true);
        await seek(page, 3.5); assert.equal((await state(page)).cardScale, 1.18);

        const rotation = await page.evaluate(() => window.__pokemonReveal.debug.card.rotation.toArray().slice(0, 3));
        assert.ok(Math.abs(rotation[1]) < 1e-5 && Math.abs(rotation[2]) < 1e-5, 'Shared final rotation is preserved');

        const memory = (await state(page)).memory;
        for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__pokemonReveal.play('dark')); await seek(page, 1.2); }
        assert.deepEqual((await state(page)).memory, memory, 'Repeated Dark playback reuses GPU resources');
        await seek(page, 0); const start = (await state(page)).renderedFrames;
        await page.evaluate(() => window.__pokemonReveal.debug.resume(0.8));
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5);
        assert.ok((await state(page)).renderedFrames > start + 20, 'Actual continuous playback renders the whole sequence');

        // Interrupt during materialization, switch away and restore the original material.
        await page.evaluate(() => window.__pokemonReveal.play('dark')); await seek(page, 1.95);
        await page.evaluate(() => window.__pokemonReveal.play('water')); await seek(page, 2.6);
        assert.equal((await state(page)).effect, 'WaterEffect');
        assert.equal(await page.evaluate(() => window.__pokemonReveal.debug.model.getObjectByName('DarkEffect').visible), false);
        assert.equal(await page.evaluate(() => window.__pokemonReveal.debug.model.getObjectByName('bottom_low001_pokeball_0').material.emissiveIntensity), 1);
        await page.locator('#pokemon-name').fill('Umbreon'); await page.locator('#pokemon-search button').click();
        await page.waitForFunction(() => !document.querySelector('#pokemon-search button').disabled && document.querySelector('#summon-status').textContent === '');
        assert.equal((await state(page)).effect, 'DarkEffect');
        await page.setViewportSize({ width: width + 40, height }); await seek(page, 2.6);
        const fit = await page.evaluate(() => {
            const rect = document.querySelector('#pokemon-search').getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
                && document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight;
        });
        assert.ok(fit, 'Canvas and summon controls fit the viewport');
        await page.screenshot({ path: path.join(out, `${profile}-resize.png`), scale: 'css' });
        await page.evaluate(() => window.__pokemonReveal.debug.setBlackBackground(false));
        await seek(page, 1.2); await page.screenshot({ path: path.join(out, `${profile}-03-sky.png`), scale: 'css' });
        await page.evaluate(() => window.__pokemonReveal.dispose());
        const disposed = await state(page); assert.equal(disposed.memory.geometries, 0); assert.ok(disposed.memory.textures <= 2);
        report.profiles.push({ profile, aura, motion, illustration, fit, disposed: disposed.memory });
        await page.context().close();
    }
    const reduced = await open(390, 844, true);
    assert.equal((await state(reduced)).time, 3.5); assert.equal((await state(reduced)).running, false);
    await reduced.screenshot({ path: path.join(out, 'mobile-reduced.png'), scale: 'css' });
    await reduced.evaluate(() => { window.__pokemonReveal.dispose(); window.__pokemonReveal.dispose(); });
    await reduced.context().close(); report.scenarios.push('Reduced motion and idempotent disposal');
    assert.deepEqual(report.errors, []); report.passed = true;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); console.log(out);
}
