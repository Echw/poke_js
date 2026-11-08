import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';
import { parseSmokeClip } from '../src/effects/smokeClipFormat.ts';
import { revealTypeForCard } from '../src/data/revealType.ts';

const out = process.env.FIGHTING_QA_DIR || path.join(os.tmpdir(), `fighting-qa-${Date.now()}`);
await mkdir(out, { recursive: true });
const report = { out, profiles: [], motion: [], scenarios: [], performance: [], errors: [], passed: false };
const browser = await launch();
const machop = { id: 'base1-52', name: 'Machop', image: 'https://assets.tcgdex.net/en/base/base1/52', types: ['Fighting'], dexId: [66] };
const localCard = await readFile('public/textures/machop-preview.webp');
const clipPattern = /\/fighting-(desktop|mobile)[^/]*\.bin(?:\?.*)?$/;
const isClip = route => !/[?&](url|import)(?:[=&]|$)/.test(route.request().url());

async function setup(width = 1280, height = 900) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await isolate(page);
    await page.route('https://api.tcgdex.net/**', route => route.fulfill({ json: route.request().url().includes('?') ? [machop] : machop }));
    await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: localCard }));
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /THREE|GLSL|WebGL|shader/i.test(m.text())) report.errors.push(m.text()); });
    return page;
}
async function open(page, reveal = 'fighting') {
    await page.goto(`http://127.0.0.1:5173/?reveal=${reveal}`);
    await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 120000 });
    await page.evaluate(() => window.__pokemonReveal.stop());
}
async function poses(page) {
    return page.evaluate(() => {
        const model = window.__pokemonReveal.debug.model, output = [];
        for (let variant = 0; variant < 6; variant++) {
            const mesh = model.getObjectByName(`FightingEarth${variant}`), matrix = mesh.matrix.clone();
            for (let i = 0; i < mesh.count; i++) {
                mesh.getMatrixAt(i, matrix);
                const p = mesh.position.clone(), s = p.clone(), q = mesh.quaternion.clone();
                matrix.decompose(p, q, s);
                output.push({ position: p.toArray(), scale: s.toArray(), quaternion: q.toArray(), matrix: matrix.toArray() });
            }
        }
        return output;
    });
}
async function fieldSummary(page) {
    return page.evaluate(async () => {
        const debug = window.__pokemonReveal.debug, bytes = debug.replayFrameData(), gpu = debug.readSmokeField();
        const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
        const half = h => (h & 1023) * 2 ** (-24) * Number((h >> 10) === 0) + Number((h >> 10) !== 0) * (1 + (h & 1023) / 1024) * 2 ** (((h >> 10) & 31) - 15);
        const data = new Uint16Array(bytes), n = debug.snapshot().mist.replay.densityResolution, tiles = Math.ceil(Math.sqrt(n)), width = tiles * n;
        let mass = 0, yMass = 0;
        for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const i = (Math.floor(z / tiles) * n + y) * width + (z % tiles) * n + x, d = half(data[i]);
            mass += d; yMass += d * (-1 + (y + 0.5) * 3.4 / n);
        }
        return { cpu: await hash(bytes), gpu: await hash(gpu), mass, centerY: yMass / Math.max(mass, 1e-6) };
    });
}
async function record(page, name, side, rate) {
    await seek(page, 0); await page.evaluate(side => window.__pokemonReveal.debug.sideView(side), side);
    await page.evaluate(() => {
        window.videoChunks = []; window.videoStream = document.querySelector('canvas').captureStream(60);
        window.videoRecorder = new MediaRecorder(window.videoStream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
        window.videoRecorder.ondataavailable = e => { if (e.data.size) window.videoChunks.push(e.data); };
        window.videoRecorder.start();
    });
    const start = Date.now();
    await page.evaluate(rate => window.__pokemonReveal.debug.resume(rate), rate);
    await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5, null, { timeout: 45000 });
    const wallMs = Date.now() - start;
    const data = await page.evaluate(async () => {
        await new Promise(resolve => { window.videoRecorder.onstop = resolve; window.videoRecorder.stop(); });
        window.videoStream.getTracks().forEach(t => t.stop());
        return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(new Blob(window.videoChunks, { type: 'video/webm' })); });
    });
    const file = `${name}-${side ? 'side' : 'front'}-${rate}x.webm`;
    await writeFile(path.join(out, file), Buffer.from(data.split(',')[1], 'base64'));
    assert.ok(wallMs > 3500 / rate - 150 && wallMs < 3500 / rate + 2000, `Duration ${wallMs}`);
    report.motion.push({ name, side, rate, file, wallMs });
    console.log('Recorded', file, wallMs);
}

try {
    assert.equal(revealTypeForCard(machop), 'fighting');
    assert.equal(revealTypeForCard({ ...machop, name: 'Geodude', dexId: [74] }), 'fighting');
    assert.equal(revealTypeForCard({ ...machop, name: 'Glaceon', dexId: [471] }), 'ice');
    assert.equal(revealTypeForCard({ ...machop, name: 'Squirtle', dexId: [7], types: ['Water'] }), 'water');
    report.scenarios.push('TCG Fighting selection and Ice precedence');
    for (const [name, width, count] of [['desktop', 1280, 48], ['mobile', 600, 28]]) {
        const page = await setup(width), downloaded = [];
        page.on('request', r => { if (/\.bin(?:\?|$)/.test(r.url()) && !/[?&](url|import)(?:[=&]|$)/.test(r.url())) downloaded.push(r.url()); });
        await open(page);
        const initial = await state(page);
        assert.equal(initial.effect, 'FightingEffect'); assert.equal(initial.duration, 3.5);
        assert.equal(initial.fighting.count, count); assert.equal(initial.mist.source, 'replay');
        assert.equal(initial.mist.replay.solverPasses, 0); assert.equal(initial.mist.simulation, undefined);
        assert.equal(downloaded.length, 1); assert.ok(downloaded[0].includes(`fighting-${name}`));
        const hulls = await page.evaluate(() => {
            const model = window.__pokemonReveal.debug.model;
            return Array.from({ length: 6 }, (_, v) => {
                const mesh = model.getObjectByName(`FightingEarth${v}`), g = mesh.geometry, p = g.getAttribute('position'), ix = g.index;
                const edges = new Map(); let volume = 0;
                const a = mesh.position.clone(), b = a.clone(), c = a.clone(), cross = a.clone();
                for (let i = 0; i < ix.count; i += 3) {
                    const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
                    a.fromBufferAttribute(p, ids[0]); b.fromBufferAttribute(p, ids[1]); c.fromBufferAttribute(p, ids[2]);
                    volume += a.dot(cross.crossVectors(b, c)) / 6;
                    for (let j = 0; j < 3; j++) { const key = [ids[j], ids[(j + 1) % 3]].sort((x, y) => x - y).join(':'); edges.set(key, (edges.get(key) ?? 0) + 1); }
                }
                return { closed: [...edges.values()].every(n => n === 2), volume, geometry: g.uuid, material: mesh.material.uuid,
                    metalness: mesh.material.metalness, roughness: mesh.material.roughness };
            });
        });
        assert.ok(hulls.every(h => h.closed && h.volume > 0 && h.metalness === 0 && h.roughness >= 0.9));
        assert.equal(new Set(hulls.map(h => h.geometry)).size, 6); assert.equal(new Set(hulls.map(h => h.material)).size, 1);
        await seek(page, 1.25); const a = await poses(page);
        await seek(page, 1.35); const b = await poses(page);
        await seek(page, 1.45); const c = await poses(page);
        for (let i = 0; i < a.length; i++) {
            assert.ok(a[i].scale.every((n, j) => Math.abs(n - c[i].scale[j]) < 1e-6), 'Rigid scale');
            assert.ok(Math.abs((a[i].position[1] - 2 * b[i].position[1] + c[i].position[1]) / 0.01 + 4.3) < 0.001, 'Ballistic gravity');
            assert.notDeepEqual(a[i].quaternion, c[i].quaternion);
        }
        await seek(page, 1.25); assert.deepEqual(await poses(page), a, 'Deterministic reverse seek');
        const bytes = await readFile(`src/assets/mist-replay/fighting-${name}.bin`);
        const header = parseSmokeClip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).header;
        const fields = [];
        for (const time of [0.8, 1.05, 1.5, 2.4]) {
            await seek(page, time); const summary = await fieldSummary(page), frame = Math.floor(time * 60 + 1e-5);
            const expected = header.profile.chunks[Math.floor(frame / 4)].frames[frame % 4].densitySHA256;
            assert.equal(summary.cpu, expected); assert.equal(summary.gpu, expected);
            fields.push({ time, ...summary });
        }
        assert.ok(fields[3].centerY > fields[0].centerY + 0.25, 'Density must rise');
        for (const side of [false, true]) {
            await page.evaluate(side => window.__pokemonReveal.debug.sideView(side), side);
            for (const time of [0.35, 0.7, 1.05, 1.8, 2.4, 3.15, 3.5]) {
                await seek(page, time);
                await page.screenshot({ path: path.join(out, `${name}-${side ? 'side' : 'front'}-${time}.png`) });
            }
            if (process.argv.includes('--motion')) for (const rate of [1, 0.2]) await record(page, name, side, rate);
        }
        await page.evaluate(() => window.__pokemonReveal.debug.sideView(false));
        await seek(page, 3.5); assert.equal((await state(page)).fighting.live, 0); assert.equal((await state(page)).cardScale, 0.94);
        for (const effect of ['ice', 'water', 'fire', 'electric', 'grass', 'psychic', 'fighting']) {
            await page.evaluate(effect => window.__pokemonReveal.play(effect), effect); await seek(page, 2.4);
            assert.equal((await state(page)).effect.toLowerCase().includes(effect), true);
            if (effect === 'ice' || effect === 'fighting') assert.equal((await state(page)).mist.source, 'replay');
        }
        await page.setViewportSize({ width: width + 60, height: 760 }); await seek(page, 1.05);
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        assert.equal((await state(page)).running, false);
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.locator('#pokemon-name').fill('Machop'); await page.locator('#pokemon-search button').click();
        await page.waitForFunction(() => !document.querySelector('#pokemon-search button').disabled && document.querySelector('#summon-status').textContent === '');
        assert.equal((await state(page)).effect, 'FightingEffect'); await seek(page, 2.4);
        await page.evaluate(() => window.__pokemonReveal.dispose()); const disposed = await state(page);
        assert.equal(disposed.memory.geometries, 0);
        assert.equal(disposed.mist.replay.dataBytes, 0); assert.equal(disposed.mist.replay.decodedBytes, 0);
        // r186 retains counters for its shared DFG_LUT and native transmission target.
        // Those are renderer-owned; forceContextLoss releases their actual GPU storage.
        assert.ok(disposed.memory.textures <= 2);
        await page.waitForFunction(() => document.querySelector('canvas').getContext('webgl2').isContextLost());
        report.profiles.push({ name, hulls, fields, downloaded: downloaded[0], disposed: disposed.memory, lifecycle: true });
        await page.context().close();
    }
    const fallback = await setup(600);
    await fallback.route(clipPattern, async route => { if (!isClip(route)) return route.continue(); await route.fulfill({ body: Buffer.from('invalid clip'), contentType: 'application/octet-stream' }); });
    await open(fallback); await seek(fallback, 1.05);
    assert.equal((await state(fallback)).mist.source, 'live'); assert.equal((await state(fallback)).mist.variant, 'fighting');
    assert.ok((await state(fallback)).mist.fallbackReason);
    await fallback.evaluate(() => window.__pokemonReveal.dispose()); await fallback.context().close();
    report.scenarios.push('Invalid Fighting clip falls back to Fighting solver');

    for (const cancel of ['switch', 'dispose']) {
        const page = await setup(600); await open(page, 'water');
        let requested; const requestSeen = new Promise(resolve => { requested = resolve; });
        await page.route(clipPattern, async route => { if (!isClip(route)) return route.continue(); requested(); await new Promise(r => setTimeout(r, 400)); await route.continue().catch(() => {}); });
        await page.evaluate(() => { window.pendingFighting = window.__pokemonReveal.play('fighting'); });
        await requestSeen;
        if (cancel === 'switch') await page.evaluate(() => window.__pokemonReveal.play('water'));
        else await page.evaluate(() => window.__pokemonReveal.dispose());
        await page.evaluate(() => window.pendingFighting);
        const current = await state(page);
        if (cancel === 'switch') assert.equal(current.effect, 'WaterEffect');
        else assert.equal(current.disposed, true);
        await page.evaluate(() => window.__pokemonReveal.dispose()); await page.context().close();
        report.scenarios.push(`Cancel pending replay: ${cancel}`);
    }
    const performancePage = await setup(1920, 1080); await open(performancePage);
    await seek(performancePage, 0); await performancePage.evaluate(() => { window.__pokemonReveal.debug.setSmokeFrameTiming(true); window.__pokemonReveal.debug.resume(1); });
    await performancePage.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5);
    const performanceState = await state(performancePage);
    report.performance.push(performanceState.frameGpu);
    assert.ok(performanceState.frameGpu.frameMs.p95 <= 16.7, 'Full HD GPU p95 budget');
    await performancePage.evaluate(() => window.__pokemonReveal.dispose()); await performancePage.context().close();
    assert.deepEqual(report.errors, []);
    report.passed = true;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close(); console.log(out);
}
