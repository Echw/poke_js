import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';

const out = process.env.ICE_CROWN_QA_DIR || path.join(os.tmpdir(), `ice-crown-${Date.now()}`);
await mkdir(out, { recursive: true });
const report = { out, profiles: [], motion: [], errors: [], passed: false };
const browser = await launch();

async function inspect(page) {
    return page.evaluate(() => {
        const { model, card } = window.__pokemonReveal.debug;
        const crown = model.getObjectByName('IceCrown'), burst = model.getObjectByName('IceBurst');
        const meshes = crown.children.filter(mesh => mesh.isInstancedMesh);
        model.updateWorldMatrix(true, true);
        const matrix = crown.matrix.clone(), inverse = card.matrixWorld.clone().invert();
        const instances = [];
        for (const mesh of meshes) for (let i = 0; i < mesh.count; i++) {
            mesh.getMatrixAt(i, matrix);
            const position = mesh.position.clone(), scale = position.clone(), quaternion = mesh.quaternion.clone();
            matrix.decompose(position, quaternion, scale);
            const tip = position.clone().fromArray(mesh.geometry.userData.iceTip).applyMatrix4(matrix)
                .applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
            const slot = Math.round((mesh.geometry.getAttribute('aIceSeed').getX(i) - 0.71) / 1.37);
            instances[slot] = { position: position.toArray(), scale: scale.toArray(), tip: tip.toArray(), matrix: matrix.toArray() };
        }
        const hulls = meshes.map(mesh => {
            const positions = mesh.geometry.getAttribute('position'), edges = new Map();
            let volume = 0;
            const a = mesh.position.clone(), b = a.clone(), c = a.clone();
            const key = vertex => [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)].map(n => n.toFixed(5)).join(',');
            for (let i = 0; i < positions.count; i += 3) {
                a.fromBufferAttribute(positions, i); b.fromBufferAttribute(positions, i + 1); c.fromBufferAttribute(positions, i + 2);
                volume += a.dot(b.clone().cross(c)) / 6;
                for (let edge = 0; edge < 3; edge++) {
                    const id = [key(i + edge), key(i + (edge + 1) % 3)].sort().join('|');
                    edges.set(id, (edges.get(id) ?? 0) + 1);
                }
            }
            return { closed: [...edges.values()].every(count => count === 2), volume,
                environment: mesh.material.envMap.uuid, privateEnvironment: mesh.material.envMap !== model.parent.environment };
        });
        let particles = 0;
        for (let i = 0; i < burst.count; i++) {
            burst.getMatrixAt(i, matrix);
            if (matrix.elements[13] > -1) particles++;
        }
        return {
            visible: crown.visible, instances, particles, burstVisible: burst.visible,
            hulls, variants: meshes.length,
            material: { transmission: meshes[0].material.transmission, ior: meshes[0].material.ior, opacity: meshes[0].material.opacity },
            card: card.material.map(m => ({ transparent: m.transparent, depthWrite: m.depthWrite, visible: m.visible })),
        };
    });
}

async function record(page, name, side, rate) {
    await seek(page, 0);
    await page.evaluate(side => window.__pokemonReveal.debug.sideView(side), side);
    await page.evaluate(() => {
        window.crownChunks = [];
        window.crownStream = document.querySelector('canvas').captureStream(60);
        window.crownRecorder = new MediaRecorder(window.crownStream,
            { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
        window.crownRecorder.ondataavailable = e => { if (e.data.size) window.crownChunks.push(e.data); };
        window.crownRecorder.start();
    });
    const started = Date.now();
    await page.evaluate(rate => window.__pokemonReveal.debug.resume(rate), rate);
    await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5, null, { timeout: 45000 });
    const wallMs = Date.now() - started;
    const video = await page.evaluate(async () => {
        await new Promise(resolve => { window.crownRecorder.onstop = resolve; window.crownRecorder.stop(); });
        window.crownStream.getTracks().forEach(track => track.stop());
        const blob = new Blob(window.crownChunks, { type: 'video/webm' });
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    });
    const file = `${name}-${side ? 'side' : 'front'}-${rate}x.webm`;
    await writeFile(path.join(out, file), Buffer.from(video.split(',')[1], 'base64'));
    assert.ok(wallMs >= 3500 / rate - 120 && wallMs < 3500 / rate + 1800, `Playback duration ${wallMs}`);
    report.motion.push({ name, side, rate, file, wallMs });
    console.log('Recorded', file, wallMs);
}

try {
    for (const [name, width, large, front] of [['desktop', 1280, 9, 5], ['mobile', 600, 6, 3]]) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        await isolate(page);
        page.on('pageerror', e => report.errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' && /THREE|WebGL|GLSL|shader/i.test(m.text())) report.errors.push(m.text()); });
        await page.goto('http://127.0.0.1:5173/?reveal=ice');
        await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '',
            null, { timeout: 120000 });
        await seek(page, 0.75);
        const emerging = await inspect(page);
        assert.ok(emerging.particles > 0 && emerging.burstVisible, 'Fragments launch during emergence');
        await seek(page, 1.25);
        const grown = await inspect(page);
        assert.equal(grown.instances.length, large * 2);
        assert.equal(grown.variants, 3);
        assert.ok(grown.hulls.every(hull => hull.closed && hull.volume > 0.05 && hull.privateEnvironment),
            'All three refraction hulls are closed, outward and use a private environment');
        assert.ok(grown.material.transmission > 0 && grown.material.transmission < 1);
        assert.equal(grown.material.opacity, 1);
        assert.ok(grown.card.every(m => !m.visible), 'No card before materialization');
        await seek(page, 2.15);
        const plate = await inspect(page);
        assert.ok(plate.card.every(m => m.visible && !m.transparent && m.depthWrite), 'Opaque refractable plate');
        const inFront = plate.instances.filter(i => i.position[2] > 0.5);
        assert.equal(inFront.length, front, 'Actual depth puts the short crown in front');
        assert.ok(inFront.every(i => i.tip[1] < -0.25), 'Front tips only cover the bottom quarter');
        assert.ok(inFront.every(i => i.tip[2] > 0), 'Front arc remains in front of the tilted card');
        const glow = await page.evaluate(() => {
            const card = window.__pokemonReveal.debug.card;
            const root = card.children.find(child => child.visible && child.children.some(mesh => mesh.renderOrder === 5));
            return root.children.find(mesh => mesh.renderOrder === 5).material.opacity;
        });
        assert.equal(glow, 0.64, 'Original glow is retained over the frozen plate');
        for (const time of [0.75, 2.4, 2.7]) {
            await seek(page, time);
            const sample = await inspect(page);
            sample.instances.forEach((instance, i) => instance.scale.forEach((scale, axis) =>
                assert.ok(Math.abs(scale - grown.instances[i].scale[axis]) < 1e-6, 'Crown remains rigid')));
            if (time === 2.4) assert.ok(sample.instances[0].position[1] < grown.instances[0].position[1], 'Crown retracts');
        }
        await seek(page, 1.25);
        assert.deepEqual((await inspect(page)).instances.map(i => i.matrix), grown.instances.map(i => i.matrix),
            'Reverse seek restores exact crystal transforms');
        for (const time of [0.3, 0.55, 0.75, 1.1, 1.25, 1.45, 1.8, 2.15, 2.4, 2.7, 2.85, 3.5]) {
            for (const side of [false, true]) {
                await seek(page, time);
                await page.evaluate(side => window.__pokemonReveal.debug.sideView(side), side);
                await page.screenshot({ path: path.join(out, `${name}-${side ? 'side' : 'front'}-${time}.png`) });
            }
        }
        assert.equal((await inspect(page)).visible, false, 'All crown hidden at finish');
        for (const type of ['water', 'fire', 'electric', 'grass', 'psychic']) {
            await page.evaluate(async type => { await window.__pokemonReveal.play(type); await window.__pokemonReveal.debug.seek(1.8); }, type);
            assert.ok((await inspect(page)).card.every(m => m.transparent && !m.depthWrite), 'Original card materials restored');
        }
        await page.evaluate(async () => { await window.__pokemonReveal.play('ice'); await window.__pokemonReveal.debug.seek(1.8); });
        assert.ok((await inspect(page)).card.every(m => !m.transparent && m.depthWrite), 'Ice materials reactivated');
        assert.deepEqual((await inspect(page)).hulls.map(hull => hull.environment), grown.hulls.map(hull => hull.environment),
            'Private reflection map is reused across seeks and effect switches');
        await page.setViewportSize({ width: width - 50, height: 760 });
        await seek(page, 2.4);
        await page.setViewportSize({ width, height: 800 });
        // Exercise the real form while keeping the public card API deterministic and local.
        await page.route('https://api.tcgdex.net/v2/en/cards?name=Glaceon', route => route.fulfill({
            json: [{ id: 'qa-glaceon', name: 'Glaceon', image: 'https://assets.tcgdex.net/qa/glaceon' }],
        }));
        await page.route('https://api.tcgdex.net/v2/en/cards/qa-glaceon', route => route.fulfill({
            json: { name: 'Glaceon', image: 'https://assets.tcgdex.net/qa/glaceon', types: ['Water'], dexId: [471] },
        }));
        await page.route('https://assets.tcgdex.net/qa/glaceon/high.webp', route => route.fulfill({
            path: path.resolve('public/textures/glaceon-preview.webp'), contentType: 'image/webp',
        }));
        await page.locator('#pokemon-name').fill('Glaceon');
        await page.getByRole('button', { name: /summon/i }).click();
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().running);
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5);
        assert.equal((await state(page)).effect, 'IceEffect');
        if (process.argv.includes('--motion')) {
            for (const side of [false, true]) for (const rate of [1, 0.2]) await record(page, name, side, rate);
        }
        report.profiles.push({ name, crown: grown.instances.length, variants: grown.variants, hulls: grown.hulls,
            foreground: front, earlyParticles: emerging.particles });
        await page.evaluate(() => window.__pokemonReveal.dispose());
        await context.close();
        console.log('Passed crown checks', name);
    }
    assert.deepEqual(report.errors, []);
    report.passed = true;
} finally {
    await writeFile(path.join(out, 'crown-results.json'), JSON.stringify(report, null, 2));
    await browser.close();
    console.log(out);
}
