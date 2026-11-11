import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';

const base = process.env.FAIRY_BASE_URL || 'http://127.0.0.1:5173';
const out = process.env.FAIRY_QA_DIR || path.join(os.tmpdir(), 'fairy-reveal-qa');
await mkdir(out, { recursive: true });
const report = { passed: false, profiles: [], errors: [] };
const browser = await launch();
const artwork = await readFile('public/textures/sylveon-preview.webp');

async function setup(width, height, reducedMotion = 'no-preference') {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
        reducedMotion, ...(width < 700 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    await isolate(page);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /THREE|GLSL|WebGL|shader/i.test(m.text())) report.errors.push(m.text()); });
    await page.route('https://api.tcgdex.net/**', route => {
        const url = new URL(route.request().url()), abra = url.searchParams.get('name') === 'Abra' || url.pathname.endsWith('base1-43');
        const card = abra ? { id: 'base1-43', name: 'Abra', dexId: [63], types: ['Psychic'], image: 'https://assets.tcgdex.net/en/base/base1/43' }
            : { id: 'xy3-72', name: 'Sylveon', dexId: [700], types: ['Fairy'], image: 'https://assets.tcgdex.net/en/xy/xy3/72' };
        return route.fulfill({ json: url.searchParams.has('name') ? [card] : card });
    });
    await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: artwork }));
    await page.goto(`${base}/?reveal=fairy`);
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
        let changed = 0, pink = 0, pearl = 0;
        for (let i = 0; i < after.length; i += 4) {
            if (Math.max(Math.abs(before[i]-after[i]),Math.abs(before[i+1]-after[i+1]),Math.abs(before[i+2]-after[i+2])) < 10) continue;
            changed++;
            const r=after[i],g=after[i+1],bl=after[i+2];
            if (r > g*1.25 && bl > g*1.08) pink++;
            if (r > 190 && g > 155 && bl > 170) pearl++;
        }
        return { changed, pink, pearl };
    }, [first.toString('base64'), second.toString('base64')]);
}

async function toggleKind(page, kind, enabled) {
    await page.evaluate(([kind, enabled]) => {
        window.__pokemonReveal.debug.model.getObjectByName('FairyEffect').traverse(o => {
            if (o.name.startsWith(`Fairy-${kind}-`)) o.material.colorWrite = enabled;
        });
    }, [kind, enabled]);
}

async function submit(page, name) {
    await page.locator('#pokemon-name').fill(name);
    await page.getByRole('button', { name: 'Summon' }).click();
    await page.waitForFunction(() => document.querySelector('#summon-status').textContent === '' && !document.querySelector('button').disabled);
}

async function look(page) {
    return page.evaluate(() => {
        const model = window.__pokemonReveal.debug.model, materials = [];
        model.traverse(o => { if (o.name === 'button_low001_pokeball_0' || o.name === 'bottom_low001_pokeball_0') materials.push(o.material.uuid); });
        return { materials, background: model.parent.backgroundIntensity, environment: model.parent.environmentIntensity };
    });
}

try {
    for (const [profile, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
        const page = await setup(width, height);
        const fairyLook = await look(page);
        assert.equal(fairyLook.background, 0.65); assert.equal(fairyLook.environment, 0.8);
        await page.evaluate(() => window.__pokemonReveal.play('psychic'));
        const originalLook = await look(page);
        await page.evaluate(() => window.__pokemonReveal.play('fairy'));
        assert.deepEqual(await look(page), fairyLook, 'Scoped material clones are reused');
        const stages = [];
        for (const [i, time] of [0.18, 0.60, 1.22, 1.82, 2.58, 3.28, 3.5].entries()) {
            await seek(page, time);
            await page.screenshot({ path: path.join(out, `${profile}-stage-${i+1}.png`) });
            stages.push(await state(page));
        }
        assert.equal(stages[2].effect, 'FairyEffect');
        assert.equal(stages[6].cardScale, 1.18); assert.equal(stages[6].running, false);
        const fit = await page.evaluate(() => {
            const r = document.querySelector('#pokemon-search').getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
                && document.documentElement.scrollWidth <= innerWidth;
        });
        assert.ok(fit, `${profile}: controls fit`);
        await seek(page, 1.22);
        const all = await page.screenshot(), contribution = {};
        for (const kind of ['stream', 'orbit', 'petal', 'dust', 'flare', 'spark', 'pool', 'star']) {
            await toggleKind(page, kind, false); await seek(page, 1.22);
            contribution[kind] = await difference(page, await page.screenshot(), all);
            assert.ok(contribution[kind].changed > (profile === 'desktop' ? 10 : 2), `${profile}: ${kind} renders ${JSON.stringify(contribution[kind])}`);
            await toggleKind(page, kind, true);
        }
        assert.ok(contribution.stream.pink > 20 && contribution.stream.pearl > 3, 'Pink structure and pearl highlights both render');
        // The local source must affect surfaces, not just add a global pink wash.
        await page.evaluate(() => {
            window.__pokemonReveal.debug.model.getObjectByName('FairyEffect').traverse(o => {
                if (!o.name.startsWith('Fairy-petal-')) return;
                o.userData.savedBeforeRender = o.onBeforeRender;
                o.onBeforeRender = function (...args) { this.userData.savedBeforeRender.apply(this,args); this.material.uniforms.uSourceLight.value=0; };
            });
        });
        await seek(page,1.22);
        const unlit=await page.screenshot({path:path.join(out,`${profile}-petals-unlit.png`)});
        const lighting=await difference(page,unlit,all);
        assert.ok(lighting.changed>(profile==='desktop'?100:30),'Petal shading responds to the local source');
        await page.evaluate(() => {
            window.__pokemonReveal.debug.model.getObjectByName('FairyEffect').traverse(o => {
                if(o.userData.savedBeforeRender){o.onBeforeRender=o.userData.savedBeforeRender;delete o.userData.savedBeforeRender;}
            });
        });
        await seek(page, 1.22); const reference = await page.screenshot();
        await seek(page, 1.30); const motion = await difference(page, reference, await page.screenshot());
        assert.ok(motion.changed > 80, 'Nearby frames move');
        await seek(page, 2.58); await seek(page, 1.22);
        assert.ok((await difference(page, reference, await page.screenshot())).changed < 10, 'Deterministic rewind');
        const resources = () => page.evaluate(() => {
            const ids=[];window.__pokemonReveal.debug.model.getObjectByName('FairyEffect').traverse(o=>{if(o.geometry)ids.push(o.geometry.uuid,o.material.uuid);});return ids;
        });
        const before = await resources();
        for(let i=0;i<3;i++){await page.evaluate(()=>window.__pokemonReveal.play('fairy'));await seek(page,1.22);}
        assert.deepEqual(await resources(),before,'Replay reuses GPU resources');
        // Exercise the actual clock, then interrupt through the visible search form.
        await seek(page,0.6);await page.evaluate(()=>window.__pokemonReveal.debug.resume());
        await page.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().time>1.2);
        await page.screenshot({path:path.join(out,`${profile}-playing.png`)});
        await submit(page,'Abra');assert.equal((await state(page)).effect,'PsychicEffect');
        assert.deepEqual(await look(page),originalLook,'Switch restores exact original materials');
        await submit(page,'Sylveon');assert.equal((await state(page)).effect,'FairyEffect');
        assert.deepEqual(await look(page),fairyLook);
        await page.setViewportSize({width:width+40,height:height-40});await seek(page,1.3);
        await page.screenshot({path:path.join(out,`${profile}-resize.png`)});
        await page.evaluate(() => {
            window.__fairyDisposals=[];
            const resources=new Set();
            window.__pokemonReveal.debug.model.getObjectByName('FairyEffect').traverse(o=>{
                if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);if(o.isInstancedMesh)resources.add(o);
            });
            for(const resource of resources){const entry={count:0};window.__fairyDisposals.push(entry);resource.addEventListener('dispose',()=>entry.count++);}
            window.__pokemonReveal.dispose();window.__pokemonReveal.dispose();
        });
        assert.equal((await state(page)).disposed,true);
        assert.ok(await page.evaluate(()=>window.__fairyDisposals.every(r=>r.count===1)),'Owned resources disposed exactly once');
        report.profiles.push({profile,stages,fit,contribution,lighting,motion});await page.context().close();
    }
    const reduced=await setup(390,844,'reduce');
    assert.equal((await state(reduced)).time,3.5);assert.equal((await state(reduced)).running,false);
    await reduced.screenshot({path:path.join(out,'reduced-motion.png')});await reduced.context().close();
    assert.deepEqual(report.errors,[]);report.passed=true;
} finally {
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();
}
console.log(`Fairy desktop/mobile WebGL, search, motion, replay, resize and disposal passed. Evidence: ${out}`);
