import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launch, isolate } from './ice-test-fixture.mjs';

const base = process.env.CHOREOGRAPHY_QA_URL || 'http://127.0.0.1:5173';
const out = path.join(os.tmpdir(), 'poke-choreography-qa');
await mkdir(out, { recursive: true });
const browser = await launch();
const report = { profiles: [], assertions: [], errors: [] };
const types = ['psychic','electric','grass','fire','water','ice','fighting','poison','ground','flying','bug','rock','ghost','dragon','dark','steel','fairy','normal'];
const selectedTypes = process.env.CHOREOGRAPHY_TYPES?.split(',') || types;
const snapshot = page => page.evaluate(() => window.__pokemonReveal.debug.snapshot());
const near = (a, b, message) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-7), message);
const ready = page => page.waitForFunction(() => window.__pokemonReveal && document.querySelector('#startup-loader').hidden, null, { timeout: 120000 });

async function run(page, type, extension = 0) {
    await page.evaluate(({ type, extension }) => {
        const api = window.__pokemonReveal;
        window.samples = [];
        window.playResult = undefined;
        window.playDone = api.play(type).then(result => { window.playResult = result; });
        window.sampleTimer = setInterval(() => window.samples.push(api.debug.snapshot()), 16);
        if (extension) {
            const extend = setInterval(() => {
                if (api.debug.snapshot().phase !== 'throw') return;
                clearInterval(extend); api.debug.extendReveal(extension);
            }, 1);
        }
    }, { type, extension });
    await page.waitForFunction(() => window.playResult !== undefined, null, { timeout: 30000 });
    const samples = await page.evaluate(() => { clearInterval(window.sampleTimer); return window.samples; });
    const end = await snapshot(page);
    assert.equal(await page.evaluate(() => window.playResult), 'completed');
    const reveal = samples.filter(s => s.phase === 'reveal');
    const falling = samples.filter(s => s.phase === 'drop');
    assert.ok(reveal.length > 2 && falling.length > 1, `${type}: sampled reveal and drop`);
    for (const frame of reveal) {
        near(frame.ballMatrix, reveal[0].ballMatrix, `${type}: stationary open shell throughout reveal`);
        assert.ok(Math.abs(frame.lidAngle + Math.PI / 4) < 1e-7);
    }
    for (const frame of falling) {
        assert.equal(frame.time, frame.duration, `${type}: drop waits for the actual timeline completion`);
        near(frame.cardMatrix, end.cardMatrix, `${type}: falling shell never moves card`);
        near(frame.cameraMatrix, reveal[0].cameraMatrix, `${type}: camera remains stationary`);
        assert.ok(Math.abs(frame.lidAngle + Math.PI / 4) < 1e-7);
        assert.ok(Math.abs(frame.ballCenter[0] - falling[0].ballCenter[0]) < 1e-7, 'Vertical fall');
    }
    assert.equal(end.phase, 'presented');
    assert.equal(end.running, false);
    assert.ok(end.ballBounds.max[1] < -1, `${type}: entire open shell below frame`);
    assert.equal(end.duration, (type === 'fire' ? 5.35 : 3.5) + extension);
    const entering = samples.find(s => s.phase === 'throw');
    assert.ok(entering && entering.ballScreenCenter[0] < -0.8 && entering.ballScreenCenter[1] < -0.2,
        'Throw enters from the lower left');
    const flight = samples.filter(s => s.phase === 'throw');
    assert.ok(entering.ballCenter[2] < reveal[0].ballCenter[2] - 5, 'Throw starts far behind the presentation plane');
    const crossing = flight.findIndex(frame => frame.ballScreenCenter[0] >= -1);
    assert.ok(crossing > 0, 'Sampled the center crossing the left edge');
    const [x0, y0] = flight[crossing - 1].ballScreenCenter;
    const [x1, y1] = flight[crossing].ballScreenCenter;
    const edgeY = y0 + (y1 - y0) * (-1 - x0) / (x1 - x0);
    assert.ok(edgeY > -0.58 && edgeY < -0.31, 'Center crosses the edge near 72% of frame height');
    const lastFlight = flight.at(-1);
    const crest = flight.reduce((top, frame) => frame.ballScreenCenter[1] > top.ballScreenCenter[1] ? frame : top);
    const [crestX, crestY] = crest.ballScreenCenter; // NDC: left = -1, top = +1.
    assert.ok(crestX > -0.56 && crestX < -0.22 && crestY > 0.18 && crestY < 0.32,
        'Arc crests near one third of the width and 38% of the height');
    assert.ok(lastFlight.ballScreenCenter[1] < crestY - 0.18, 'Shell descends toward its opening pose');
    // Compare perspective magnification at the center: a projected world AABB
    // exaggerates size off-axis and changes with yaw, especially on portrait screens.
    const cameraZ = entering.cameraMatrix[14];
    assert.ok(cameraZ - entering.ballCenter[2] > (cameraZ - lastFlight.ballCenter[2]) * 2, 'Perspective grows the incoming ball');
    const halfwayTime = lastFlight.motionTime * 0.5;
    const halfway = flight.reduce((nearest, frame) => Math.abs(frame.motionTime - halfwayTime) < Math.abs(nearest.motionTime - halfwayTime) ? frame : nearest);
    const halfwaySize = (cameraZ - lastFlight.ballCenter[2]) / (cameraZ - halfway.ballCenter[2]);
    assert.ok(halfwaySize < 0.35, 'Ball remains distant through mid-flight; perspective growth comes late');
    for (const frame of flight) {
        assert.equal(frame.lidAngle, 0, 'Closed shell during flight');
    }
    // The local up vector is the normal of the band. It leans right when the button faces away.
    assert.ok(flight.some(({ ballMatrix: m }) => m[10] < -0.8 && m[4] > 0.42),
        'The black band visibly tilts right on the back of the spinning shell');
    const settle = samples.filter(frame => frame.phase === 'settle');
    assert.ok(settle.length, 'Sampled the closed shell before opening');
    // The rotation matrix trace measures the full angle to the resting pose, including yaw.
    const rotationTrace = m => m[0] + m[5] + m[10];
    assert.ok(rotationTrace(lastFlight.ballMatrix) > 1 + 2 * Math.cos(5 * Math.PI / 180),
        'The last airborne pose is within 5 degrees of neutral before the handoff');
    for (const frame of settle) {
        assert.ok(Math.abs(rotationTrace(frame.ballMatrix) - 3) < 1e-7, 'Shell faces front at rest');
        assert.equal(frame.lidAngle, 0, 'Lid stays closed until the spin has stopped');
    }
    return { type, duration: end.duration, phases: [...new Set(samples.map(s => s.phase))] };
}

try {
    for (const [width, height] of [[1280, 900], [390, 844]].filter(([width]) => !process.env.CHOREOGRAPHY_WIDTH || width === Number(process.env.CHOREOGRAPHY_WIDTH))) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage(); await isolate(page);
        page.on('pageerror', error => report.errors.push(error.message));
        let requests = 0;
        await page.route('https://api.tcgdex.net/**', async route => {
            requests++;
            const name = new URL(route.request().url()).searchParams.get('name') || 'Eevee';
            if (name === 'missing') return route.fulfill({ json: [] });
            if (name === 'error') return route.abort();
            const card = { id: name, name, image: '/textures/eevee-preview.webp', dexId: [133], types: ['Colorless'] };
            return route.fulfill({ json: new URL(route.request().url()).searchParams.has('name') ? [card] : card });
        });
        await page.goto(base); await ready(page);
        const form = await page.locator('#pokemon-search').boundingBox();
        const idle = await snapshot(page);
        assert.equal(idle.idle, true);
        await page.evaluate(() => window.__pokemonReveal.setCardImage('/textures/eevee-preview.webp'));
        const results = [];
        // All types at normal speed exercise real callbacks and smoke streaming.
        for (const type of selectedTypes) {
            results.push(await run(page, type));
            console.log(`PASS ${width} ${type}`);
        }
        results.push(await run(page, 'normal', 0.6));
        assert.deepEqual(await page.locator('#pokemon-search').boundingBox(), form, 'Search form never moves');

        // The actual form locks both button and programmatic/Enter submission.
        await page.locator('#pokemon-name').fill('Eevee');
        await page.locator('button[type=submit]').click();
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().phase === 'throw');
        const before = requests;
        await page.evaluate(() => document.querySelector('#pokemon-search').requestSubmit());
        assert.equal(requests, before);
        for (const phase of ['throw', 'opening', 'reveal', 'drop', 'presented']) {
            await page.waitForFunction(phase => window.__pokemonReveal.debug.snapshot().phase === phase, phase);
            if (phase !== 'presented') await page.waitForFunction(phase => {
                const s = window.__pokemonReveal.debug.snapshot();
                return s.phase === phase && (phase === 'reveal' ? s.time > 1.8 : s.motionTime > (phase === 'opening' ? 1.2 : 0.25));
            }, phase);
            await page.screenshot({ path: path.join(out, `${width}-${phase}.png`) });
        }
        await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);

        // Pause/resume in flight and resize in the reveal/drop lifecycle.
        await page.evaluate(() => { window.result = undefined; window.__pokemonReveal.play('normal').then(r => { window.result = r; }); });
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().phase === 'throw');
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        const paused = await snapshot(page);
        await page.waitForTimeout(100);
        near((await snapshot(page)).ballMatrix, paused.ballMatrix, 'Hidden tab pauses flight');
        await page.setViewportSize({ width: width + 40, height: height - 40 });
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: false });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().phase === 'drop');
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => window.result === 'completed');
        assert.ok((await snapshot(page)).ballBounds.max[1] < -1);

        // Failed searches preserve the already displayed card and offscreen shell.
        const stable = await snapshot(page);
        for (const name of ['missing', 'error']) {
            await page.locator('#pokemon-name').fill(name);
            await page.locator('button[type=submit]').click();
            await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
            near((await snapshot(page)).cardMatrix, stable.cardMatrix, 'Failed fetch preserves card');
            assert.equal((await snapshot(page)).phase, 'presented');
        }
        const cancelled = await page.evaluate(async () => {
            const api = window.__pokemonReveal;
            const first = api.play('ice'), second = api.play('normal');
            api.stop();
            return Promise.all([first, second]);
        });
        assert.deepEqual(cancelled, ['cancelled', 'cancelled']);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.evaluate(() => window.__pokemonReveal.play('steel')), 'completed');
        const reduced = await snapshot(page);
        assert.equal(reduced.duration, 3.5); assert.equal(reduced.phase, 'presented');
        assert.ok(reduced.ballBounds.max[1] < -1 && reduced.cardVisible);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const disposed = await page.evaluate(async () => {
            const api = window.__pokemonReveal, pending = api.play('normal');
            api.dispose(); api.dispose(); return pending;
        });
        assert.equal(disposed, 'cancelled');
        report.profiles.push({ width, height, results });
        await context.close();
    }
    assert.deepEqual(report.errors, []);
    console.log(`PASS choreography: ${selectedTypes.length} types across ${report.profiles.length} profiles; extended reveal, form lock, resize, visibility, cancellation and reduced motion`);
} catch (error) {
    report.assertions.push(error.stack); throw error;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
}
