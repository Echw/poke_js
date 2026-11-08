import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';
import { isFlyingCard } from '../src/data/flyingSpecies.ts';
import { revealTypeForCard } from '../src/data/revealType.ts';

const base = process.env.FLYING_BASE_URL || 'http://127.0.0.1:5173';
const out = process.env.FLYING_QA_DIR || path.join(os.tmpdir(), `flying-qa-${Date.now()}`);
const baseline = process.env.FLYING_BASELINE_DIR;
await mkdir(out, { recursive: true });
const report = { out, profiles: [], scenarios: [], motion: [], regression: [], performance: [], errors: [], passed: false };
const browser = await launch();
const artwork = await readFile('public/textures/pidgeotto-preview.webp');
const cards = {
    Pidgeotto: { id: 'base1-22', name: 'Pidgeotto', image: 'https://assets.tcgdex.net/en/base/base1/22', types: ['Colorless'], dexId: [17] },
    Charizard: { id: 'base1-4', name: 'Charizard', image: 'https://assets.tcgdex.net/en/base/base1/4', types: ['Fire'], dexId: [6] },
    Abra: { id: 'base1-43', name: 'Abra', image: 'https://assets.tcgdex.net/en/base/base1/43', types: ['Psychic'], dexId: [63] },
};
function card(name, dexId, types = ['Colorless']) { return { name, dexId: dexId ? [dexId] : [], types, image: '' }; }

async function setup(width = 1280, height = 900) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await isolate(page);
    await page.route('https://api.tcgdex.net/**', route => {
        const url = new URL(route.request().url());
        const selected = cards[url.searchParams.get('name')] ?? Object.values(cards).find(c => url.pathname.endsWith(c.id)) ?? cards.Pidgeotto;
        return route.fulfill({ json: url.searchParams.has('name') ? [selected] : selected });
    });
    await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: artwork }));
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /THREE|GLSL|WebGL|shader/i.test(message.text())) report.errors.push(message.text()); });
    await page.goto(`${base}/?reveal=flying`);
    await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 60000 });
    await page.evaluate(() => window.__pokemonReveal.stop());
    return page;
}

async function resources(page) {
    return page.evaluate(() => {
        const entries = [];
        window.__pokemonReveal.debug.model.getObjectByName('FlyingEffect').traverse(o => {
            if (o.geometry) entries.push([o.geometry.uuid, o.material.uuid]);
        });
        return entries;
    });
}

/** Compare actual rendered pixels, not shader strings or mocked uniforms. */
async function imageDifference(page, first, second) {
    return page.evaluate(async ([first, second]) => {
        const pixels = async data => {
            const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
            const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
            return { data: ctx.getImageData(0, 0, img.width, img.height).data, width: img.width };
        };
        const a = await pixels(first), b = await pixels(second);
        let changed = 0, mass = 0, cx = 0, cy = 0, max = 0;
        for (let i = 0; i < a.data.length; i += 4) {
            const delta = Math.max(Math.abs(a.data[i]-b.data[i]), Math.abs(a.data[i+1]-b.data[i+1]), Math.abs(a.data[i+2]-b.data[i+2]));
            max = Math.max(max, delta);
            if (delta < 5) continue;
            changed++; mass += delta; cx += (i/4 % a.width)*delta; cy += Math.floor(i/4/a.width)*delta;
        }
        return { changed, max, x: cx/Math.max(1,mass), y: cy/Math.max(1,mass) };
    }, [first.toString('base64'), second.toString('base64')]);
}

async function record(page, profile, side, rate) {
    await seek(page, 0);
    await page.evaluate(() => {
        window.flyingChunks = [];
        window.flyingStream = document.querySelector('canvas').captureStream(60);
        window.flyingRecorder = new MediaRecorder(window.flyingStream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
        window.flyingRecorder.ondataavailable = e => { if (e.data.size) window.flyingChunks.push(e.data); };
        window.flyingRecorder.start();
    });
    const start = Date.now();
    await page.evaluate(rate => window.__pokemonReveal.debug.resume(rate), rate);
    await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5, null, { timeout: 40000 });
    const wallMs = Date.now()-start;
    const data = await page.evaluate(async () => {
        await new Promise(resolve => { window.flyingRecorder.onstop = resolve; window.flyingRecorder.stop(); });
        window.flyingStream.getTracks().forEach(track => track.stop());
        return new Promise(resolve => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(new Blob(window.flyingChunks, { type: 'video/webm' }));
        });
    });
    const file = `${profile}-${side ? 'side' : 'front'}-${rate}x.webm`;
    await writeFile(path.join(out, file), Buffer.from(data.split(',')[1], 'base64'));
    assert.ok(wallMs > 3500/rate-180 && wallMs < 3500/rate+2500, `Playback duration: ${wallMs}`);
    report.motion.push({ file, wallMs });
}

try {
    for (const c of [card('Pidgeotto',17),card('Pidgey',16),card('Pidgeot ex',18),card('Tornadus',641),card('Pidgeotto',0),card("Falkner's Pidgeot ex",0)]) {
        assert.equal(isFlyingCard(c), true, c.name); assert.equal(revealTypeForCard(c), 'flying', c.name);
    }
    for (const c of [card('Eevee',133),card('Ditto',132),card('Galarian Farfetch’d',83),card('M Gyarados EX',130),card('M Charizard X EX',6),card('Shaymin',492),card('Rotom',479)]) assert.equal(isFlyingCard(c), false, c.name);
    for (const c of [card('Shaymin Sky Forme',492),card('Fan Rotom',479),card('Mega Pinsir',127),card('Mega Clefable',36)]) assert.equal(isFlyingCard(c), true, c.name);
    for (const [c, type] of [[card('Charizard',6,['Fire']),'fire'],[card('Articuno',144,['Water']),'ice'],[card('Natu',177,['Psychic']),'psychic'],[card('Gligar',207,['Fighting']),'ground'],[card('Zubat',41,['Grass']),'poison'],[card('Butterfree',12,['Grass']),'grass'],[card('Zapdos',145,['Lightning']),'electric'],[card('Gyarados',130,['Water']),'water'],[card('Hawlucha',701,['Fighting']),'fighting']]) assert.equal(revealTypeForCard(c), type, c.name);
    report.scenarios.push('Species, named forms, missing Dex IDs, non-Flying Colorless and existing type precedence');

    for (const [profile, width, height, count, bands] of [['desktop',1280,900,6,3],['mobile',390,844,4,2]]) {
        const page = await setup(width,height);
        const initial = await state(page);
        assert.equal(initial.effect,'FlyingEffect'); assert.equal(initial.duration,3.5);
        assert.equal(initial.flying.feathers,count); assert.equal(initial.flying.bands,bands);
        assert.equal(initial.mist,undefined);
        const identities = await resources(page);
        for (const side of [false,true]) {
            await page.evaluate(side => window.__pokemonReveal.debug.sideView(side),side);
            for (const time of [0.3,0.65,1.05,1.8,2.4,3.1,3.5]) {
                await seek(page,time);
                await page.screenshot({path:path.join(out,`${profile}-${side?'side':'front'}-${time}.png`)});
            }
            if (process.argv.includes('--motion')) for (const rate of [1,0.2]) await record(page,profile,side,rate);
        }
        await page.evaluate(() => { window.__pokemonReveal.debug.sideView(false); window.__pokemonReveal.debug.setFlyingFeathers(false); });
        await seek(page,1.05);
        assert.equal((await state(page)).flying.visibleDraws,4);
        await page.screenshot({path:path.join(out,`${profile}-no-feathers.png`)});
        await page.evaluate(() => window.__pokemonReveal.debug.setBlackBackground(true));
        await page.screenshot({path:path.join(out,`${profile}-black-no-feathers.png`)});
        const glints=[];
        for (const time of [0.85,0.93,1.15]) {
            await seek(page,time);
            const on=await page.screenshot();
            await page.evaluate(() => window.__pokemonReveal.debug.model.getObjectByName('FlyingEffect').traverse(o => { if(o.material?.uniforms?.uHighlights) o.material.uniforms.uHighlights.value=0; }));
            await seek(page,time); const off=await page.screenshot();
            const difference=await imageDifference(page,on,off); glints.push({time,...difference});
            assert.ok(difference.changed > 10 && difference.max > 12, 'Local highlights visible without feathers or bloom');
            await page.evaluate(() => window.__pokemonReveal.debug.model.getObjectByName('FlyingEffect').traverse(o => { if(o.material?.uniforms?.uHighlights) o.material.uniforms.uHighlights.value=1; }));
        }
        assert.ok(Math.hypot(glints[0].x-glints[1].x,glints[0].y-glints[1].y)>2,'Highlights move between frames');
        await page.evaluate(() => { window.__pokemonReveal.debug.setBlackBackground(false); window.__pokemonReveal.debug.setFlyingFeathers(true); });
        await seek(page,1.05); const reference=await page.screenshot();
        await seek(page,2.5); await seek(page,1.05);
        const rewindDifference=await imageDifference(page,reference,await page.screenshot());
        // GSAP rounds restored Euler values to six decimals (subpixel coverage).
        assert.ok(rewindDifference.changed<=8 && rewindDifference.max<=16,'Deterministic reverse seek within raster precision');
        const memory=(await state(page)).memory;
        for(let i=0;i<5;i++){await page.evaluate(()=>window.__pokemonReveal.play('flying'));await seek(page,1.05);}
        assert.deepEqual((await state(page)).memory,memory,'Stable GPU resources on restart');
        assert.deepEqual(await resources(page),identities,'No rebuilt geometry or material');
        for(const effect of ['grass','psychic','water','electric','flying']) {
            await page.evaluate(effect=>window.__pokemonReveal.play(effect),effect);await seek(page,2.4);
            assert.equal((await state(page)).effect.toLowerCase().includes(effect),true);
            const visible=await page.evaluate(()=>window.__pokemonReveal.debug.model.getObjectByName('FlyingEffect').visible);
            assert.equal(visible,effect==='flying');
        }
        await page.setViewportSize({width:width+35,height:height-40});
        await page.waitForFunction(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return r.width===innerWidth && r.height===innerHeight;});
        await seek(page,1.05);
        const fit=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,button:document.querySelector('button').getBoundingClientRect().bottom}));
        assert.ok(fit.scrollWidth<=fit.width && fit.scrollHeight<=fit.height && fit.button<fit.height);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
        await page.evaluate(()=>window.__pokemonReveal.play('flying'));assert.equal((await state(page)).running,false);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
        await page.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().running);
        await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.__pokemonReveal.play('flying'));
        const end=await state(page);assert.equal(end.time,3.5);assert.equal(end.flying.visibleDraws,0);assert.equal(end.cardScale,0.94);
        await page.emulateMedia({reducedMotion:'no-preference'});
        for(const [name,effect] of [['Charizard','FireEffect'],['Pidgeotto','FlyingEffect'],['Abra','PsychicEffect']]){
            await page.locator('#pokemon-name').fill(name);await page.locator('button').click();
            await page.waitForFunction(effect=>window.__pokemonReveal.debug.snapshot().effect===effect && document.querySelector('#summon-status').textContent==='',effect);
        }
        await page.evaluate(()=>{window.__pokemonReveal.dispose();window.__pokemonReveal.dispose();});
        const disposed=await state(page);assert.equal(disposed.disposed,true);assert.equal(disposed.memory.geometries,0);assert.ok(disposed.memory.textures<=2);
        report.profiles.push({profile,glints,fit,memory,disposed:disposed.memory});
        await page.context().close();
    }
    report.scenarios.push('Six stages, front/side, wind alone, black background, highlight pixel differences, rewind, repeat, interruption, type changes, resize, visibility, reduced motion, search form, disposal');

    if(baseline){
        const page=await setup();const machop=await readFile('public/textures/machop-preview.webp');
        await page.evaluate(data=>window.__pokemonReveal.setCardImage(`data:image/webp;base64,${data}`),machop.toString('base64'));
        for(const effect of ['psychic','grass']){
            await page.evaluate(effect=>window.__pokemonReveal.play(effect),effect);
            for(const time of [1.05,1.8,2.4,3.5]){
                await seek(page,time);const now=await page.screenshot();const before=await readFile(path.join(baseline,`baseline-${effect}-${time}.png`));
                const difference=await imageDifference(page,before,now);assert.ok(difference.changed<=8 && difference.max<=16,`${effect} visual regression at ${time}: ${JSON.stringify(difference)}`);
                report.regression.push({effect,time,...difference});
            }
        }
        await page.evaluate(()=>window.__pokemonReveal.dispose());await page.context().close();
    }
    const performancePage=await setup(1920,1080);
    await seek(performancePage,0);await performancePage.evaluate(()=>{window.__pokemonReveal.debug.setSmokeFrameTiming(true);window.__pokemonReveal.debug.resume(1);});
    await performancePage.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().time===3.5);
    const gpu=(await state(performancePage)).frameGpu;report.performance.push(gpu);
    if(gpu.count>0)assert.ok(gpu.frameMs.p95<=16.7,'Full HD GPU p95 budget');
    await performancePage.evaluate(()=>window.__pokemonReveal.dispose());await performancePage.context().close();
    assert.deepEqual(report.errors,[]);report.passed=true;
} finally {
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
    await browser.close();console.log(out);
}
