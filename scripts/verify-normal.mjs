import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';

const base = process.env.NORMAL_BASE_URL || 'http://127.0.0.1:5173';
const out = process.env.NORMAL_QA_DIR || path.join(os.tmpdir(), 'normal-reveal-qa');
await mkdir(out, { recursive: true });
const browser = await launch();
const artwork = await readFile('public/textures/eevee-preview.webp');
const report = { passed: false, profiles: [], errors: [] };

async function setup(width, height, reducedMotion = 'no-preference') {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
        reducedMotion, ...(width < 700 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    await isolate(page);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error' && /THREE|GLSL|WebGL|shader/i.test(message.text())) report.errors.push(message.text());
    });
    await page.route('https://api.tcgdex.net/**', route => {
        const url = new URL(route.request().url());
        const abra = url.searchParams.get('name') === 'Abra' || url.pathname.endsWith('base1-43');
        const card = abra ? { id: 'base1-43', name: 'Abra', dexId: [63], types: ['Psychic'], image: 'https://assets.tcgdex.net/en/base/base1/43' }
            : { id: 'base2-51', name: 'Eevee', dexId: [133], types: ['Colorless'], image: 'https://assets.tcgdex.net/en/base/base2/51' };
        return route.fulfill({ json: url.searchParams.has('name') ? [card] : card });
    });
    await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: artwork }));
    await page.goto(`${base}/?reveal=normal`);
    await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 60000 });
    await page.evaluate(() => window.__pokemonReveal.stop());
    return page;
}

async function difference(page, a, b, below = 0.88) {
    return page.evaluate(async ([a, b, below]) => {
        async function pixels(data) {
            const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        }
        const first = await pixels(a), second = await pixels(b);
        let changed = 0, bright = 0, neutral = 0, warm = 0, bottom = 0;
        for (let i = 0; i < first.length; i += 4) {
            if (Math.max(...[0, 1, 2].map(j => Math.abs(first[i+j] - second[i+j]))) < 9) continue;
            changed++;
            if (i / 4 >= first.length / 4 * below) bottom++;
            const r = second[i], g = second[i+1], bl = second[i+2];
            if (r > 90) bright++;
            if (r > 90 && Math.max(r, g, bl) - Math.min(r, g, bl) < 35) neutral++;
            if (r > 100 && r > bl * 1.6 && r > g * 1.2) warm++;
        }
        return { changed, bright, neutral, warm, bottom };
    }, [a.toString('base64'), b.toString('base64'), below]);
}

async function layer(page, kind, enabled) {
    await page.evaluate(([kind, enabled]) => {
        window.__pokemonReveal.debug.model.getObjectByName('NormalEffect').traverse(object => {
            if (object.name.startsWith(`Normal-${kind}-`)) object.material.colorWrite = enabled;
        });
    }, [kind, enabled]);
}

async function submit(page, name) {
    await page.locator('#pokemon-name').fill(name);
    await page.getByRole('button', { name: 'Summon' }).click();
    await page.waitForFunction(() => document.querySelector('#summon-status').textContent === '' && !document.querySelector('button').disabled);
}

try {
    for (const [profile, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
        const page = await setup(width, height);
        const stages = [];
        for (const [i, time] of [0.18, 0.62, 1.28, 1.86, 2.58, 3.18, 3.5].entries()) {
            await seek(page, time);
            await page.screenshot({ path: path.join(out, `${profile}-stage-${i+1}.png`) });
            stages.push(await state(page));
        }
        assert.equal(stages[2].effect, 'NormalEffect');
        assert.equal(stages[6].cardScale, 1.18);
        assert.equal(stages[6].running, false);
        const fit = await page.evaluate(() => {
            const r = document.querySelector('#pokemon-search').getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
                && document.documentElement.scrollWidth <= innerWidth;
        });
        assert.ok(fit, `${profile}: visible controls fit`);
        await page.evaluate(() => {
            const model = window.__pokemonReveal.debug.model;
            const mesh = model.getObjectByName('Normal-stream-front'), before = mesh.onBeforeRender;
            mesh.onBeforeRender = function (renderer, scene, camera, ...args) {
                this.onBeforeRender = before; before.call(this, renderer, scene, camera, ...args);
                let bottom = 0;
                model.traverse(object => {
                    if (!object.isMesh || !object.name.startsWith('bottom_')) return;
                    object.geometry.computeBoundingBox();
                    const box = object.geometry.boundingBox;
                    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
                        const p = box.min.clone().set(x, y, z).applyMatrix4(object.matrixWorld).project(camera);
                        bottom = Math.max(bottom, (1 - p.y) / 2);
                    }
                });
                window.__normalBallBottom = bottom;
            };
        });
        await seek(page, 1.28);
        const belowBall = await page.evaluate(() => window.__normalBallBottom + 2 / innerHeight);
        assert.ok(belowBall > 0.5 && belowBall < 1, 'Located lower Ball boundary in the viewport');
        const background = await page.evaluate(() => {
            const scene = window.__pokemonReveal.debug.model.parent;
            return { texture: scene.background?.uuid, intensity: scene.backgroundIntensity, environment: scene.environmentIntensity };
        });
        assert.ok(background.texture, 'Original sky texture remains active');
        assert.equal(background.intensity, 0.65); assert.equal(background.environment, 0.8);
        const reference = await page.screenshot(), contribution = {};
        // Minimum screen coverage rejects the former nearly invisible wire and specks.
        const coverage = { stream: 0.003, source: 0.0004, pool: 0.00008, star: 0.0003, dust: 0.00012,
            aura: 0.001, orbit: 0.0005, mote: 0.0002 };
        for (const kind of ['stream', 'source', 'pool', 'star', 'dust', 'aura', 'orbit', 'mote']) {
            await layer(page, kind, false); await seek(page, 1.28);
            contribution[kind] = await difference(page, await page.screenshot(), reference, belowBall);
            assert.ok(contribution[kind].changed > width * height * coverage[kind], `${profile} ${kind}: ${JSON.stringify(contribution[kind])}`);
            assert.equal(contribution[kind].bottom, 0, 'No effect pixels below the Ball');
            await layer(page, kind, true);
        }
        assert.ok(contribution.stream.neutral > contribution.stream.bright * 0.85,
            `Bright stream stays predominantly white: ${JSON.stringify(contribution.stream)}`);
        assert.ok(contribution.stream.warm < contribution.stream.changed * 0.02, 'No yellow/orange shift');

        await page.evaluate(() => {
            const model = window.__pokemonReveal.debug.model;
            model.parent.children.find(object => object.isPointLight).visible = false;
        });
        await seek(page, 1.28);
        const bowlLight = await difference(page, await page.screenshot(), reference);
        assert.ok(bowlLight.changed > (profile === 'desktop' ? 100 : 30), 'Local source actually lights the model');
        await page.evaluate(() => {
            window.__pokemonReveal.debug.model.parent.children.find(object => object.isPointLight).visible = true;
        });

        // Same clock and opacity, shorter path: growth reveals length, not the whole shape at once.
        await page.evaluate(() => {
            window.__pokemonReveal.debug.model.getObjectByName('NormalEffect').traverse(object => {
                if (!object.name.startsWith('Normal-stream-')) return;
                object.userData.savedBeforeRender = object.onBeforeRender;
                object.onBeforeRender = function (...args) {
                    this.userData.savedBeforeRender.apply(this, args); this.material.uniforms.uGrowth.value = 0.30;
                };
            });
        });
        await seek(page, 1.28);
        const growth = await difference(page, await page.screenshot(), reference);
        assert.ok(growth.changed > (profile === 'desktop' ? 100 : 30), 'Spiral grows from its source');
        await page.evaluate(() => {
            window.__pokemonReveal.debug.model.getObjectByName('NormalEffect').traverse(object => {
                if (object.userData.savedBeforeRender) {
                    object.onBeforeRender = object.userData.savedBeforeRender; delete object.userData.savedBeforeRender;
                }
            });
        });

        // Separate flow clock: path, strip width, camera and growth stay exactly fixed.
        await page.evaluate(() => {
            window.__pokemonReveal.debug.model.getObjectByName('NormalEffect').traverse(object => {
                if (!object.name.startsWith('Normal-stream-')) return;
                object.userData.savedBeforeRender = object.onBeforeRender;
                object.onBeforeRender = function (...args) {
                    this.userData.savedBeforeRender.apply(this, args); this.material.uniforms.uFlowTime.value = 1.65;
                };
            });
        });
        await seek(page, 1.28);
        const flow = await difference(page, reference, await page.screenshot());
        assert.ok(flow.changed > (profile === 'desktop' ? 100 : 35), 'Light packets move independently of the geometry');
        await page.evaluate(() => {
            window.__pokemonReveal.debug.model.getObjectByName('NormalEffect').traverse(object => {
                if (object.userData.savedBeforeRender) {
                    object.onBeforeRender = object.userData.savedBeforeRender; delete object.userData.savedBeforeRender;
                }
            });
        });
        await seek(page, 2.58); await seek(page, 1.28);
        assert.ok((await difference(page, reference, await page.screenshot())).changed < 10, 'Deterministic rewind');
        const resources = () => page.evaluate(() => {
            const ids = [];
            window.__pokemonReveal.debug.model.getObjectByName('NormalEffect').traverse(object => {
                if (object.geometry) ids.push(object.geometry.uuid, object.material.uuid);
            });
            return ids;
        });
        const before = await resources();
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.__pokemonReveal.play('normal')); await seek(page, 1.28);
        }
        assert.deepEqual(await resources(), before, 'Replays reuse materials and geometry');
        await seek(page, 0.5); await page.evaluate(() => window.__pokemonReveal.debug.resume());
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time > 1.3);
        await page.screenshot({ path: path.join(out, `${profile}-playing.png`) });
        await submit(page, 'Abra'); assert.equal((await state(page)).effect, 'PsychicEffect');
        await submit(page, 'Eevee'); assert.equal((await state(page)).effect, 'NormalEffect');
        await page.setViewportSize({ width: width + 40, height: height - 40 }); await seek(page, 1.3);
        await page.screenshot({ path: path.join(out, `${profile}-resize.png`) });
        await page.evaluate(() => {
            window.__normalDisposals = [];
            const resources = new Set();
            window.__pokemonReveal.debug.model.getObjectByName('NormalEffect').traverse(object => {
                if (object.geometry) resources.add(object.geometry);
                if (object.material) resources.add(object.material);
                if (object.isInstancedMesh) resources.add(object);
            });
            for (const resource of resources) {
                const entry = { count: 0 }; window.__normalDisposals.push(entry);
                resource.addEventListener('dispose', () => entry.count++);
            }
            window.__pokemonReveal.dispose(); window.__pokemonReveal.dispose();
        });
        assert.ok(await page.evaluate(() => window.__normalDisposals.every(resource => resource.count === 1)), 'Resources disposed exactly once');
        assert.equal((await state(page)).disposed, true);
        report.profiles.push({ profile, stages, fit, contribution, bowlLight, growth, flow });
        await page.context().close();
    }
    const reduced = await setup(390, 844, 'reduce');
    assert.equal((await state(reduced)).time, 3.5); assert.equal((await state(reduced)).running, false);
    await reduced.screenshot({ path: path.join(out, 'reduced-motion.png') });
    await reduced.context().close();
    assert.deepEqual(report.errors, []); report.passed = true;
} finally {
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close();
}
console.log(`Normal desktop/mobile stages, white light, flow, search interruption, replay, resize, reduced motion and disposal passed. Evidence: ${out}`);
