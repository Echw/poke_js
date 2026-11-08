import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DataUtils } from 'three';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';
import { POISON_EVENTS, POISON_EVENT_CAPACITY, POISON_LIMITS, POISON_LEVEL, POISON_GRAVITY, bubblePose, dropPose, poisonHeight } from '../src/effects/poisonEvents.ts';
import { revealTypeForCard } from '../src/data/revealType.ts';
import { isPoisonCard } from '../src/data/poisonSpecies.ts';
import { parseSmokeClip, restoreSmokeChunk } from '../src/effects/smokeClipFormat.ts';

const out = process.env.POISON_QA_DIR || path.join(os.tmpdir(), `poison-qa-${Date.now()}`);
await mkdir(out, { recursive: true });
const report = { out, scenarios: [], profiles: [], motion: [], performance: [], errors: [], passed: false };
const koffing = { id: 'base1-51', name: 'Koffing', image: 'https://assets.tcgdex.net/en/base/base1/51', types: ['Grass'], dexId: [109] };
const artwork = await readFile('public/textures/koffing-preview.webp');
const clips = /\/poison-(desktop|mobile)[^/]*\.bin(?:\?.*)?$/;
const isClip = route => !/[?&](url|import)(?:[=&]|$)/.test(route.request().url());

function verifyEvents() {
    assert.equal(POISON_EVENTS.length, 16);
    assert.ok(POISON_EVENTS.length <= POISON_EVENT_CAPACITY);
    for (const mobile of [false, true]) {
        const events = POISON_EVENTS.filter(e => !mobile || e.mobile);
        const limits = POISON_LIMITS[mobile ? 'mobile' : 'desktop'];
        for (let frame = 0; frame <= 210; frame++) {
            const time = frame / 60;
            assert.ok(events.filter(e => bubblePose(e, time, events).visible).length <= limits.bubbles);
            assert.ok(events.flatMap(e => Array.from({ length: limits.dropsPerEvent }, (_, i) => dropPose(e, i, time, events))).filter(p => p.visible).length <= limits.drops);
        }
        for (const e of events) {
            assert.ok(Math.hypot(e.x, e.z - 0.05) + e.radius < 0.88, 'Dome foot stays inside basin');
            const early = bubblePose(e, e.start + e.grow * 0.3, events), full = bubblePose(e, e.start + e.grow, events);
            assert.equal(bubblePose(e,e.start+0.03,events).visible,false,'Surface begins bulging before membrane appears');
            assert.ok(early.radius < full.radius);
            assert.ok(full.y - full.radius < poisonHeight(e.x, e.z, e.start + e.grow, events), 'Attached lower membrane is submerged');
            const closed = bubblePose(e, e.pop, events), torn = bubblePose(e, e.pop + 0.09, events), gone = bubblePose(e, e.pop + 0.18, events);
            assert.equal(closed.rupture, 0); assert.ok(torn.rupture > 0.4 && torn.rupture < 0.6); assert.equal(gone.visible, false);
            assert.equal(closed.radius, torn.radius, 'Rupture does not shrink the sphere');
            const t = e.pop + 0.16, dt = 0.01;
            const a = dropPose(e, 0, t - dt, events), b = dropPose(e, 0, t, events), c = dropPose(e, 0, t + dt, events);
            assert.ok(Math.abs((c.y - 2 * b.y + a.y) / (dt * dt) + POISON_GRAVITY) < 1e-8);
            const birth = dropPose(e, 0, e.pop + 0.045, events);
            const origin = bubblePose(e, birth.birth, events);
            const reach = Math.hypot(birth.x - (e.gas ? origin.x : e.x), birth.z - (e.gas ? origin.z : e.z));
            assert.ok(reach >= e.radius * 0.79 && reach <= e.radius * 1.3, 'Drop originates on the local splash or membrane');
            if (e.gas) assert.ok(birth.y > POISON_LEVEL + 0.2, 'Airborne rupture releases drops from the membrane');
            assert.ok(Math.abs(poisonHeight(e.x, e.z, 3.5, events) - POISON_LEVEL) < 1e-9);
            if (e.gas) {
                assert.equal(full.x, e.x, 'No lateral drift before detachment');
                assert.equal(full.z, e.z);
                assert.ok(closed.y > full.y + 0.7, 'Gas rises before rupture');
                assert.ok(Math.abs(closed.x) > 1.3 && Math.abs(closed.x) < 1.5, 'Gas reaches outside the bowl on both sides');
                assert.equal(Math.sign(closed.x - e.x), Math.sign(e.x));
                const angle=e.seed, speed=0.68+0.18*Math.sin(e.seed);
                assert.ok(Math.abs(birth.vx - origin.vx - Math.cos(angle)*speed) < 1e-9, 'Drop inherits lateral membrane velocity');
                assert.ok(Math.abs(birth.vy - origin.vy - 0.28 - 0.20*Math.sin(e.seed)) < 1e-9, 'Drop inherits upward membrane velocity');
                const earlier=bubblePose(e,e.pop-0.01,events), later=bubblePose(e,e.pop+0.01,events);
                assert.ok(Math.abs((later.x-earlier.x)/0.02-closed.vx)<0.002, 'Reported gas velocity matches its trajectory');
                assert.deepEqual(bubblePose(e,e.pop,events),closed,'Absolute-time rewind preserves the same state');
            }
            if(e.start>=1.45)assert.ok(Math.abs(e.x)>=0.5,'Late births leave the card corridor clear');
        }
    }
    for (const [name, id, energy, expected] of [
        ['Koffing',109,'Grass','poison'], ['Koffing',109,'Psychic','poison'], ['Koffing',109,'Darkness','poison'],
        ['Bulbasaur',1,'Grass','grass'], ['Ivysaur',2,'Grass','grass'], ['Venusaur',3,'Grass','grass'],
        ['Oddish',43,'Grass','grass'], ['Beedrill',15,'Grass','bug'], ['Gengar',94,'Psychic','poison'],
        ['Tentacruel',73,'Water','water'], ['Toxtricity',849,'Lightning','electric'], ['Iron Moth',994,'Fire','fire'],
        ['Nidoking',34,'Fighting','poison'], ['Crobat',169,'Darkness','poison'], ['Skrelp',690,'Water','poison'],
        ['Galarian Slowbro',80,'Darkness','poison'], ['Slowbro',80,'Water','water'],
        ['Galarian Slowking',199,'Psychic','poison'], ['Slowking',199,'Water','water'],
        ['Hisuian Sneasel',215,'Fighting','fighting'], ['Sneasel',215,'Darkness','ice'],
        ['Sneasler',903,'Fighting','fighting'], ['Hisuian Qwilfish',211,'Darkness','poison'],
        ['Paldean Wooper',194,'Fighting','poison'], ['Wooper',194,'Water','water'],
        ['Galarian Weezing',110,'Darkness','poison'], ['Alolan Muk',89,'Darkness','poison'],
        ['Chikorita',152,'Grass','grass'], ['Glaceon',471,'Water','ice'], ['Machop',66,'Fighting','fighting'],
        ['Squirtle',7,'Water','water'], ['Pikachu',25,'Lightning','electric'], ['Charmander',4,'Fire','fire'], ['Abra',63,'Psychic','psychic'],
    ]) assert.equal(revealTypeForCard({ name, dexId: [id], types: [energy], image: '' }), expected, name);
    for (const name of ['Koffing', "Team Rocket's Koffing", 'Team Rocket’s Koffing', 'Galarian Slowbro V',
        'Slowbro-Galar', 'Galarian Slowking VMAX', 'Slowking-Galar', 'Paldean Wooper', 'Wooper-Paldea',
        'Alolan Muk GX', "Team Rocket's Alolan Muk GX", 'Galarian Weezing', 'Nidoran♀', 'Nidoran♂', 'Nidoran-F', 'Nidoran-M'])
        assert.equal(revealTypeForCard({ name, dexId: [], types: [], image: '' }), 'poison', name);
    for (const [name, energy, expected] of [
        ['Bulbasaur','Grass','grass'], ['Ivysaur','Grass','grass'], ['Venusaur ex','Grass','grass'],
        ['Radiant Venusaur','Grass','grass'], ['M Venusaur EX','Grass','grass'], ['Erika’s Bulbasaur','Grass','grass'],
        ['Gengar VMAX','Psychic','poison'], ['Toxtricity V','Lightning','electric'],
        ['Hisuian Sneasel','Fighting','fighting'], ['Slowbro','Water','water'], ['Wooper','Water','water'],
        ['Unknown Pokémon','Grass','grass'], ['Unknown Pokémon','Metal','psychic'],
    ]) {
        const card = { name, dexId: [], types: [energy], image: '' };
        assert.equal(isPoisonCard(card), false, name);
        assert.equal(revealTypeForCard(card), expected, name);
    }
    report.scenarios.push('Primary vs secondary Poison, regional forms, aliases and legacy routing; dome contact, expanding rupture, outward gas trajectories, inherited drop velocity, gravity, bounded pools');
}

if (process.argv.includes('--events')) { verifyEvents(); console.log('Poison event and species contracts passed'); process.exit(0); }
/** Density above the bowl must reach both sides without running into the volume edge. */
function verifySmokeSpread(bytes) {
    const {header:h,payloadOffset}=parseSmokeClip(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
    const spread=[];
    for(const frame of [96,120]) {
        const chunk=h.profile.chunks.find(c=>c.first<=frame&&c.first+c.count>frame);
        const packed=gunzipSync(bytes.subarray(payloadOffset+chunk.offset,payloadOffset+chunk.offset+chunk.bytes));
        const field=restoreSmokeChunk(packed,h,chunk), n=h.profile.resolution, tiles=h.profile.tiles;
        const start=(frame-chunk.first)*h.profile.width*h.profile.height;
        let left=Infinity,right=-Infinity;
        for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
            const py=h.domainMin[1]+(y+0.5)*h.domainSize/n;
            if(py<0||py>1.5)continue;
            const index=start+(Math.floor(z/tiles)*n+y)*h.profile.width+(z%tiles)*n+x;
            if(DataUtils.fromHalfFloat(field[index])<=0.025)continue;
            const px=h.domainMin[0]+(x+0.5)*h.domainSize/n;
            left=Math.min(left,px);right=Math.max(right,px);
        }
        assert.ok(left < -1.2 && right > 1.2, 'Both smoke plumes extend beyond the bowl');
        assert.ok(left > -1.65 && right < 1.65, 'Smoke dissipates before the volume boundary');
        spread.push({time:frame/60,left,right,width:right-left});
    }
    return spread;
}
const browser = await launch();
async function setup(width = 1280, height = 900) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage(); await isolate(page);
    await page.route('https://api.tcgdex.net/**', route => route.fulfill({ json: route.request().url().includes('?') ? [koffing] : koffing }));
    await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: artwork }));
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /THREE|GLSL|WebGL|shader/i.test(m.text())) report.errors.push(m.text()); });
    return page;
}
async function open(page, reveal = 'poison') {
    await page.goto(`http://127.0.0.1:5173/?reveal=${reveal}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 120000 });
    await page.evaluate(() => window.__pokemonReveal.stop());
}
async function record(page, name, side, rate) {
    await seek(page, 0); await page.evaluate(side => window.__pokemonReveal.debug.sideView(side), side);
    await page.evaluate(() => {
        window.videoChunks = []; window.videoStream = document.querySelector('canvas').captureStream(60);
        window.videoRecorder = new MediaRecorder(window.videoStream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
        window.videoRecorder.ondataavailable = e => { if (e.data.size) window.videoChunks.push(e.data); };
        window.videoRecorder.start();
    });
    const start = Date.now(); await page.evaluate(rate => window.__pokemonReveal.debug.resume(rate), rate);
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
    report.motion.push({ file, wallMs }); console.log('Recorded', file);
}
try {
    verifyEvents();
    for (const [name, width] of [['desktop',1280], ['mobile',600]]) {
        const page = await setup(width), downloaded = [];
        page.on('request', r => { if (/\.bin(?:\?|$)/.test(r.url()) && !/[?&](url|import)(?:[=&]|$)/.test(r.url())) downloaded.push(r.url()); });
        await open(page); const initial = await state(page);
        assert.equal(initial.effect, 'PoisonEffect'); assert.equal(initial.duration, 3.5);
        assert.equal(initial.mist.source, 'replay'); assert.equal(initial.mist.simulation, undefined);
        assert.equal(downloaded.length, 1); assert.ok(downloaded[0].includes(`poison-${name}`));
        const bytes = await readFile(`src/assets/mist-replay/poison-${name}.bin`);
        const smokeSpread = verifySmokeSpread(bytes);
        const header = parseSmokeClip(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)).header;
        assert.deepEqual(header.profile.chunks.flatMap(c=>c.frames.map(f=>f.sourceFrame)), header.sourceFrameIndices);
        for (const frame of [24,66,144,198]) {
            await seek(page, frame / 60);
            const hashes = await page.evaluate(async () => {
                const d = window.__pokemonReveal.debug;
                const sha = async b => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)), x => x.toString(16).padStart(2,'0')).join('');
                return [await sha(d.replayFrameData()),await sha(d.readSmokeField())];
            });
            assert.deepEqual(hashes, Array(2).fill(header.profile.chunks[Math.floor(frame / 4)].frames[frame % 4].densitySHA256));
        }
        await page.evaluate(() => window.__pokemonReveal.debug.clearSmokeReadback());
        for (const side of [false,true]) {
            await page.evaluate(side => window.__pokemonReveal.debug.sideView(side),side);
            for (const time of [0.35,0.60,0.95,1.08,1.12,1.17,1.24,1.60,1.95,2.15,2.4,2.9,3.5]) {
                await seek(page,time); const s = await state(page);
                assert.ok(s.poison.liveBubbles <= s.poison.bubbleCapacity); assert.ok(s.poison.liveDrops <= s.poison.dropCapacity);
                await page.screenshot({path:path.join(out,`${name}-${side?'side':'front'}-${time}.png`)});
            }
            if (process.argv.includes('--motion')) for (const rate of [1,0.2]) await record(page,name,side,rate);
        }
        await page.evaluate(() => window.__pokemonReveal.debug.sideView(false));
        await seek(page,1.17); const before = (await state(page)).poison;
        await seek(page,0.2); await seek(page,1.17); assert.deepEqual((await state(page)).poison,before);
        await seek(page,3.5); assert.equal((await state(page)).poison.liveBubbles,0); assert.equal((await state(page)).poison.liveDrops,0);
        assert.equal((await state(page)).cardScale,0.94);
        for (const effect of ['water','ice','fighting','grass','electric','fire','psychic','poison']) {
            await page.evaluate(effect => window.__pokemonReveal.play(effect),effect); await seek(page,1.17);
            assert.equal((await state(page)).effect.toLowerCase().includes(effect),true);
            if(effect==='water')await page.screenshot({path:path.join(out,`${name}-water-regression.png`)});
        }
        await page.setViewportSize({width:width+40,height:760}); await seek(page,2.4);
        await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); });
        assert.equal((await state(page)).running,false);
        await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange')); });
        await page.locator('#pokemon-name').fill('Koffing'); await page.locator('#pokemon-search button').click();
        await page.waitForFunction(() => !document.querySelector('#pokemon-search button').disabled && document.querySelector('#summon-status').textContent === '');
        assert.equal((await state(page)).effect,'PoisonEffect');
        await page.evaluate(() => { window.__pokemonReveal.dispose(); window.__pokemonReveal.dispose(); });
        const disposed=await state(page); assert.equal(disposed.memory.geometries,0); assert.ok(disposed.memory.textures<=2);
        assert.equal(disposed.mist.replay.dataBytes,0); assert.equal(disposed.mist.replay.decodedBytes,0);
        report.profiles.push({name,downloaded,disposed:disposed.memory,rewind:true,lifecycle:true,smokeSpread});
        await page.context().close(); console.log('Passed',name);
    }
    const fallback=await setup(600);
    await fallback.route(clips,route=>isClip(route)?route.fulfill({body:Buffer.from('invalid clip')}):route.continue());
    await open(fallback); await seek(fallback,1.1);
    assert.equal((await state(fallback)).mist.source,'live'); assert.equal((await state(fallback)).mist.variant,'poison');
    await fallback.evaluate(()=>window.__pokemonReveal.dispose()); await fallback.context().close();
    report.scenarios.push('Invalid replay falls back to Poison solver');
    for(const cancel of ['switch','dispose']) {
        const page=await setup(600); await open(page,'water');
        let requested; const seen=new Promise(resolve=>{requested=resolve;});
        await page.route(clips,async route=>{if(!isClip(route))return route.continue();requested();await new Promise(r=>setTimeout(r,400));await route.continue().catch(()=>{});});
        await page.evaluate(()=>{window.pendingPoison=window.__pokemonReveal.play('poison');}); await seen;
        if(cancel==='switch')await page.evaluate(()=>window.__pokemonReveal.play('water'));
        else await page.evaluate(()=>window.__pokemonReveal.dispose());
        await page.evaluate(()=>window.pendingPoison);
        const s=await state(page); if(cancel==='switch')assert.equal(s.effect,'WaterEffect');else assert.equal(s.disposed,true);
        await page.evaluate(()=>window.__pokemonReveal.dispose()); await page.context().close(); report.scenarios.push(`Interrupted preparation: ${cancel}`);
    }
    const performancePage=await setup(1920,1080); await open(performancePage); await seek(performancePage,0);
    await performancePage.evaluate(()=>{const d=window.__pokemonReveal.debug;d.setSmokeFrameTiming(true);d.resetSmokeTiming();d.resume(1);});
    await performancePage.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().time===3.5);
    const timing=(await state(performancePage)).frameGpu; report.performance.push(timing);
    assert.ok(timing.count>60); assert.ok(timing.frameMs.p95<=16.7,'Full HD GPU p95 budget');
    await performancePage.evaluate(()=>window.__pokemonReveal.dispose()); await performancePage.context().close();
    assert.deepEqual(report.errors,[]); report.passed=true;
} finally {
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)); await browser.close(); console.log(out);
}
