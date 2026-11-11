import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';

const base = process.env.DRAGON_BASE_URL || 'http://127.0.0.1:5173';
const out = process.env.DRAGON_QA_DIR || path.join(os.tmpdir(), 'dragon-reveal-qa');
await mkdir(out, { recursive: true });
const report = { passed: false, profiles: [], scenarios: [], errors: [] };
const browser = await launch();
const artwork = await readFile('public/textures/dragonair-preview.webp');

async function setup(width, height, reducedMotion = 'no-preference') {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
        reducedMotion, ...(width < 700 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    await isolate(page);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /THREE|GLSL|WebGL|shader/i.test(m.text())) report.errors.push(m.text()); });
    await page.route('https://api.tcgdex.net/**', route => {
        const url = new URL(route.request().url());
        const abra = url.searchParams.get('name') === 'Abra' || url.pathname.endsWith('base1-43');
        const card = abra
            ? { id: 'base1-43', name: 'Abra', dexId: [63], types: ['Psychic'], image: 'https://assets.tcgdex.net/en/base/base1/43' }
            : { id: 'base1-18', name: 'Dragonair', dexId: [148], types: ['Colorless'], image: 'https://assets.tcgdex.net/en/base/base1/18' };
        return route.fulfill({ json: url.searchParams.has('name') ? [card] : card });
    });
    await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: artwork }));
    await page.goto(`${base}/?reveal=dragon`);
    await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 60000 });
    await page.evaluate(() => window.__pokemonReveal.stop());
    return page;
}

async function difference(page, first, second) {
    return page.evaluate(async ([a, b]) => {
        async function pixels(data) {
            const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
            const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
            return ctx.getImageData(0, 0, c.width, c.height).data;
        }
        const before = await pixels(a), after = await pixels(b);
        let changed = 0, blue = 0, violet = 0;
        for (let i = 0; i < after.length; i += 4) {
            if (Math.max(...[0, 1, 2].map(c => Math.abs(before[i+c]-after[i+c]))) < 12) continue;
            changed++;
            const [r, g, bl] = after.slice(i, i+3);
            if (bl > r*1.25 && g > r*1.18) blue++;
            if (bl > g*1.3 && r > g*1.4) violet++;
        }
        return { changed, blue, violet };
    }, [first.toString('base64'), second.toString('base64')]);
}

async function toggleKind(page, kind, enabled) {
    await page.evaluate(([kind, enabled]) => {
        window.__pokemonReveal.debug.model.getObjectByName('DragonEffect').traverse(o => {
            if (o.name.startsWith(`Dragon-${kind}-`)) o.material.colorWrite = enabled;
        });
    }, [kind, enabled]);
}

async function submit(page, name) {
    await page.locator('#pokemon-name').fill(name);
    await page.getByRole('button', { name: 'Summon' }).click();
    await page.waitForFunction(() => document.querySelector('#summon-status').textContent === '' && !document.querySelector('button').disabled);
}

async function ballLook(page) {
    return page.evaluate(() => {
        const model = window.__pokemonReveal.debug.model;
        const materials = [];
        model.traverse(o => {
            if (o.name === 'button_low001_pokeball_0' || o.name === 'bottom_low001_pokeball_0') {
                materials.push({ name: o.name, uuid: o.material.uuid, metalness: o.material.metalness,
                    emissive: o.material.emissive.getHexString(), intensity: o.material.emissiveIntensity });
            }
        });
        return { materials, background: model.parent.backgroundIntensity,
            environment: model.parent.environmentIntensity };
    });
}

try {
    for (const [profile, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
        const page = await setup(width, height);
        const dragonLook = await ballLook(page);
        assert.equal(dragonLook.background, 0.65, 'Dragon preserves the original starfield');
        await page.evaluate(() => window.__pokemonReveal.play('psychic'));
        const originalLook = await ballLook(page);
        assert.equal(originalLook.background, 0.65);
        assert.equal(originalLook.environment, 0.8);
        assert.ok(originalLook.materials.every(m => m.metalness === 1 && m.emissive === 'ffffff'));
        await page.evaluate(() => window.__pokemonReveal.play('dragon'));
        assert.deepEqual(await ballLook(page), dragonLook, 'Dragon reuses its scoped material clones');
        await page.evaluate(() => {
            window.__dragonDisposals = {};
            window.__pokemonReveal.debug.model.traverse(o => {
                if (o.name === 'button_low001_pokeball_0' || o.name === 'bottom_low001_pokeball_0') {
                    const id = o.material.uuid;
                    window.__dragonDisposals[id] = 0;
                    o.material.addEventListener('dispose', () => window.__dragonDisposals[id]++);
                }
            });
        });
        const stages = [];
        for (const [i, time] of [0.18, 0.60, 1.22, 1.82, 2.58, 3.5].entries()) {
            await seek(page, time);
            await page.screenshot({ path: path.join(out, `${profile}-stage-${i+1}.png`) });
            stages.push(await state(page));
        }
        assert.equal(stages[2].effect, 'DragonEffect');
        assert.equal(stages[5].cardScale, 1.18);
        assert.equal(stages[5].running, false);
        const fit = await page.evaluate(() => {
            const r = document.querySelector('#pokemon-search').getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
                && document.documentElement.scrollWidth <= innerWidth;
        });
        assert.ok(fit, `${profile}: controls fit the viewport`);
        await seek(page, 1.22);
        const all = await page.screenshot();
        const contribution = {};
        for (const kind of ['stream', 'orbit', 'dust', 'wisp', 'flare', 'spark', 'pool', 'star']) {
            await toggleKind(page, kind, false); await seek(page, 1.22);
            contribution[kind] = await difference(page, await page.screenshot(), all);
            assert.ok(contribution[kind].changed > (profile === 'desktop' ? 20 : 4), `${profile}: ${kind} changes rendered pixels`);
            await toggleKind(page, kind, true);
        }
        assert.ok(contribution.stream.blue > 20 && contribution.stream.violet > 20, `${profile}: both blue and violet are visible`);
        await seek(page, 1.22);
        const deterministic = await page.screenshot();
        await seek(page, 1.28);
        const moving = await difference(page, deterministic, await page.screenshot());
        assert.ok(moving.changed > 100, 'Energy moves between nearby frames');
        await seek(page, 2.58); await seek(page, 1.22);
        const rewound = await page.screenshot();
        const rewindDiff = await difference(page, deterministic, rewound);
        await writeFile(path.join(out, `${profile}-rewound.png`), rewound);
        assert.ok(rewindDiff.changed < 10, `Rewind pixel difference: ${JSON.stringify(rewindDiff)}`);
        const resources = () => page.evaluate(() => {
            const values = [];
            window.__pokemonReveal.debug.model.getObjectByName('DragonEffect').traverse(o => { if (o.geometry) values.push(o.geometry.uuid, o.material.uuid); });
            return values;
        });
        const before = await resources();
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.__pokemonReveal.play('dragon'));
            await seek(page, 1.22);
        }
        assert.deepEqual(await resources(), before, 'Replay reuses GPU resources');
        await submit(page, 'Abra');
        assert.equal((await state(page)).effect, 'PsychicEffect');
        assert.deepEqual(await ballLook(page), originalLook, 'Other reveals regain exact original materials and environment');
        await submit(page, 'Dragonair');
        assert.equal((await state(page)).effect, 'DragonEffect');
        assert.deepEqual(await ballLook(page), dragonLook);
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5);
        await page.screenshot({ path: path.join(out, `${profile}-search-result.png`) });
        report.profiles.push({ profile, stages, contribution, moving, fit });
        await page.evaluate(() => { window.__pokemonReveal.dispose(); window.__pokemonReveal.dispose(); });
        assert.equal((await state(page)).disposed, true);
        assert.deepEqual(await page.evaluate(() => Object.values(window.__dragonDisposals)), [1, 1], 'Scoped materials are disposed once');
        await page.context().close();
    }
    const reduced = await setup(390, 844, 'reduce');
    const final = await state(reduced);
    assert.equal(final.time, 3.5); assert.equal(final.running, false);
    await reduced.screenshot({ path: path.join(out, 'reduced-motion.png') });
    report.scenarios.push('reduced motion: final card without animation', 'interrupt with Psychic and return through search', 'replay preserves resources', 'deterministic rewind', 'idempotent disposal');
    await reduced.context().close();
    assert.deepEqual(report.errors, []);
    report.passed = true;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
}
console.log(`Dragon desktop/mobile rendering, lifecycle and search checks passed. Evidence: ${out}`);
