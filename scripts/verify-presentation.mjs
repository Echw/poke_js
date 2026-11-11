import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launch, isolate } from './ice-test-fixture.mjs';

const base = process.env.CHOREOGRAPHY_QA_URL || 'http://127.0.0.1:5173';
const types = ['psychic', 'electric', 'grass', 'fire', 'water', 'ice', 'fighting', 'poison', 'ground',
    'flying', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy', 'normal'];
const output = path.join(os.tmpdir(), 'poke-presentation-qa');
await mkdir(output, { recursive: true });
const browser = await launch();
const report = { profiles: [], errors: [], assertions: [] };
try {
    for (const [width, height] of [[1280, 900], [390, 844]]) {
        const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await isolate(page);
        page.on('pageerror', error => report.errors.push(error.message));
        await page.goto(base);
        await page.waitForFunction(() => window.__pokemonReveal && document.querySelector('#startup-loader').hidden,
            null, { timeout: 120000 });
        await page.evaluate(() => window.__pokemonReveal.setCardImage('/textures/eevee-preview.webp'));
        const results = [];
        for (const mode of ['after', 'during']) {
            let reference;
            for (const type of types) {
                const result = await page.evaluate(async ({ mode, type }) => {
                    const api = window.__pokemonReveal;
                    api.setPresentationMode(mode);
                    await api.play(type);
                    const completed = api.debug.snapshot();
                    await api.debug.seek(1.8);
                    const forming = api.debug.snapshot().cardMatrix;
                    await api.debug.seek(2.15);
                    const reveal = api.debug.snapshot();
                    const start = mode === 'during' ? 2.15 : completed.duration;
                    const intersections = [];
                    // Dense geometric sampling catches even a one-frame lid/rim crossing.
                    for (let step = 0; step <= 90; step++) {
                        await api.debug.seek(start + step * 0.01);
                        const hits = api.debug.cardIntersections();
                        if (hits.length) intersections.push({ time: start + step * 0.01, hits });
                    }
                    return { forming, revealScale: reveal.cardScale, revealMatrix: reveal.cardMatrix,
                        completed: { phase: completed.phase, progress: completed.presentationProgress,
                            cardBounds: completed.cardBounds, lidAngle: completed.lidAngle }, intersections };
                }, { mode, type });
                assert.equal(result.revealScale, 1.18, `${mode}/${type}: uniform reveal scale`);
                reference ??= result;
                for (const key of ['forming', 'revealMatrix']) assert.ok(result[key].every((v, i) => Math.abs(v - reference[key][i]) < 1e-7),
                    `${mode}/${type}: same card pose during materialization`);
                assert.deepEqual(result.intersections, [], `${width}/${mode}/${type}: card clears shell geometry`);
                assert.equal(result.completed.phase, 'presented');
                assert.equal(result.completed.progress, 1);
                const bounds = result.completed.cardBounds;
                assert.ok(Math.abs((bounds.max[1] - bounds.min[1]) / 2 - 0.55) < 0.001);
                assert.ok(Math.abs(bounds.min[0] + bounds.max[0]) < 1e-7 && Math.abs(bounds.min[1] + bounds.max[1]) < 1e-7);
                assert.ok((bounds.min[0] + 1) * width / 2 >= 24 && (1 - bounds.max[0]) * width / 2 >= 24);
                assert.ok(Math.abs(result.completed.lidAngle + 110 * Math.PI / 180) < 1e-7);
                results.push({ mode, type, revealScale: result.revealScale, completed: result.completed });
                console.log(`PASS presentation ${width} ${mode} ${type}`);
            }
            // Capture the focus midpoint and final card with the shell still open for visual review.
            for (const [name, offset] of [['midpoint', 0.3], ['open', 0.9]]) {
                await page.evaluate(async ({ mode, offset }) => {
                    const api = window.__pokemonReveal;
                    const start = mode === 'during' ? 2.15 : api.debug.snapshot().duration;
                    await api.debug.seek(start + offset);
                }, { mode, offset });
                await page.screenshot({ path: path.join(output, `${width}-${mode}-${name}.png`) });
            }
        }
        // Narrow/short viewport fitting is based on actual projection, not a fixed world scale.
        await page.setViewportSize({ width: 320, height: 844 });
        const narrow = await page.evaluate(() => window.__pokemonReveal.debug.snapshot().cardBounds);
        assert.ok((narrow.min[0] + 1) * 160 >= 23.9 && (1 - narrow.max[0]) * 160 >= 23.9);
        report.profiles.push({ width, height, results });
        await context.close();
    }
    assert.deepEqual(report.errors, []);
    console.log('PASS presentation: 18 types x 2 modes x 2 viewports; uniform reveal, 55% framing, dense shell clearance and reduced motion');
} catch (error) {
    report.assertions.push(error.stack);
    throw error;
} finally {
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
}
