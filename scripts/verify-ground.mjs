import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';
import { revealTypeForCard } from '../src/data/revealType.ts';
import { GROUND_EVENTS, GROUND_PILLARS } from '../src/effects/groundEvents.ts';
import { parseSmokeClip } from '../src/effects/smokeClipFormat.ts';

const out = process.env.GROUND_QA_DIR || path.join(os.tmpdir(), `ground-qa-${Date.now()}`);
await mkdir(out, { recursive: true });
const report = { out, profiles: [], scenarios: [], motion: [], errors: [], passed: false };
const browser = await launch();
const card = { id: 'base1-62', name: 'Sandshrew', image: 'https://assets.tcgdex.net/en/base/base1/62', types: ['Fighting'], dexId: [27] };
const artwork = await readFile('public/textures/sandshrew-preview.webp');
const clips = /\/ground-(desktop|mobile)[^/]*\.bin(?:\?.*)?$/;
const isClip = route => !/[?&](url|import)(?:[=&]|$)/.test(route.request().url());

async function setup(width = 1280, height = 900) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage(); await isolate(page);
    await page.route('https://api.tcgdex.net/**', route => route.fulfill({ json: route.request().url().includes('?') ? [card] : card }));
    await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: artwork }));
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /THREE|GLSL|WebGL|shader/i.test(m.text())) report.errors.push(m.text()); });
    return page;
}
async function open(page, reveal = 'ground') {
    await page.goto(`http://127.0.0.1:5173/?reveal=${reveal}`);
    await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 120000 });
    await page.evaluate(() => window.__pokemonReveal.stop());
}
async function poses(page) {
    return page.evaluate(() => {
        const model = window.__pokemonReveal.debug.model, pillars = [], debris = [], rubble = [];
        for (let i = 0; i < 5; i++) {
            const m = model.getObjectByName(`GroundPillar${i}`);
            pillars.push({ position: m.position.toArray(), scale: m.scale.toArray(), visible: m.visible });
        }
        for (let i = 0; i < 6; i++) {
            const m = model.getObjectByName(`GroundDebris${i}`), matrix = m.matrix.clone();
            for (let j = 0; j < m.count; j++) { m.getMatrixAt(j, matrix); debris.push(matrix.toArray()); }
            const rock=model.getObjectByName(`GroundRubble${i}`);
            rubble.push({y:rock.position.y,scale:rock.scale.toArray(),visible:rock.visible});
        }
        return { pillars, debris, rubble };
    });
}
async function record(page, profile, side, rate) {
    await seek(page, 0);
    await page.evaluate(() => {
        window.chunks = []; window.stream = document.querySelector('canvas').captureStream(60);
        window.recorder = new MediaRecorder(window.stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8000000 });
        window.recorder.ondataavailable = e => { if (e.data.size) window.chunks.push(e.data); }; window.recorder.start();
    });
    const start = Date.now(); await page.evaluate(rate => window.__pokemonReveal.debug.resume(rate), rate);
    await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5, null, { timeout: 45000 });
    const wallMs = Date.now() - start;
    const data = await page.evaluate(async () => {
        await new Promise(resolve => { window.recorder.onstop = resolve; window.recorder.stop(); });
        window.stream.getTracks().forEach(t => t.stop());
        return new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(new Blob(window.chunks, { type: 'video/webm' })); });
    });
    const file = `${profile}-${side ? 'side' : 'front'}-${rate}x.webm`;
    await writeFile(path.join(out, file), Buffer.from(data.split(',')[1], 'base64'));
    assert.ok(wallMs > 3500 / rate - 150 && wallMs < 3500 / rate + 2500, `Playback duration ${wallMs}`);
    report.motion.push({ file, wallMs }); console.log('Recorded', file);
}

try {
    for (const [name, id, expected] of [['Sandshrew',27,'ground'],['Machop',66,'fighting'],['Geodude',74,'rock'],['Alolan Sandshrew',27,'ice'],['Alolan Marowak',105,'fire'],['Galarian Yamask',562,'ground'],['Yamask',562,'fighting'],['Nidoking',34,'poison'],['Garchomp',445,'ground'],['Groudon',383,'ground']]) {
        assert.equal(revealTypeForCard({ ...card, name, dexId: [id] }), expected, name);
    }
    for (const name of ["Brock's Sandshrew", 'Great Tusk ex', 'Galarian Yamask', 'Bloodmoon Ursaluna ex']) assert.equal(revealTypeForCard({ ...card, name, dexId: [] }), 'ground', name);
    assert.equal(GROUND_EVENTS.length, 15); assert.equal(GROUND_PILLARS.length, 5);
    report.scenarios.push('Primary Ground, secondary-type exclusions, forms, aliases and Ice/Poison precedence');
    for (const [profile, width, fragments] of [['desktop',1280,75],['mobile',600,45]]) {
        const page = await setup(width), requests = [];
        page.on('request', r => { if (/\.bin(?:\?|$)/.test(r.url()) && !/[?&](url|import)(?:[=&]|$)/.test(r.url())) requests.push(r.url()); });
        await open(page);
        const initial = await state(page);
        assert.equal(initial.effect, 'GroundEffect'); assert.equal(initial.duration, 3.5);
        assert.equal(initial.ground.fragments, fragments); assert.equal(initial.mist.source, 'replay');
        assert.equal(initial.mist.simulation, undefined); assert.equal(requests.length, 1); assert.ok(requests[0].includes(`ground-${profile}`));
        const textureLoads=await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('/textures/ground/')).map(r=>r.name));
        assert.equal(textureLoads.length,2,'Ground awaits both local rock maps before playback');
        const hulls = await page.evaluate(() => Array.from({ length: 5 }, (_, i) => {
            const m = window.__pokemonReveal.debug.model.getObjectByName(`GroundPillar${i}`), g = m.geometry, p = g.attributes.position, ix = g.index;
            const edges = new Map(); let volume = 0;
            const a = m.position.clone(), b = a.clone(), c = a.clone(), cross = a.clone();
            for (let j = 0; j < ix.count; j += 3) {
                const ids = [ix.getX(j),ix.getX(j+1),ix.getX(j+2)];
                a.fromBufferAttribute(p,ids[0]); b.fromBufferAttribute(p,ids[1]); c.fromBufferAttribute(p,ids[2]); volume += a.dot(cross.crossVectors(b,c))/6;
                for (let k = 0; k < 3; k++) { const key = [ids[k],ids[(k+1)%3]].sort((x,y)=>x-y).join(':'); edges.set(key,(edges.get(key)||0)+1); }
            }
            return { closed:[...edges.values()].every(n=>n===2), volume, finite:[...p.array].every(Number.isFinite), geometry:g.uuid, material:m.material.uuid,
                roughness:m.material.roughness, metalness:m.material.metalness, opacity:m.material.opacity, transparent:m.material.transparent };
        }));
        assert.ok(hulls.every(h=>h.closed&&h.volume>0&&h.finite&&h.roughness>=0.9&&h.metalness===0&&h.opacity===1&&!h.transparent));
        assert.equal(new Set(hulls.map(h=>h.geometry)).size,5); assert.equal(new Set(hulls.map(h=>h.material)).size,1);
        await seek(page,0.25);assert.ok((await poses(page)).rubble.every(r=>!r.visible&&r.y===-.42),'Foreground starts below the bowl');
        await seek(page,0.65);const emerging=(await poses(page)).rubble;
        assert.ok(emerging.every(r=>r.y>-.42&&r.y<0),'Foreground translates upward progressively');
        assert.ok(new Set(emerging.map(r=>r.y)).size>3,'Foreground emergence is staggered');
        await seek(page,1.2); const full=await poses(page);
        assert.ok(full.rubble.every(r=>r.visible&&r.y===0),'Foreground fully emerges');
        await seek(page,2.75);const sinking=(await poses(page)).rubble;
        assert.ok(sinking.every((r,i)=>r.y<0&&r.y>-.42&&JSON.stringify(r.scale)===JSON.stringify(full.rubble[i].scale)),'Foreground sinks at fixed scale');
        await seek(page,3.15);assert.ok((await poses(page)).rubble.every(r=>!r.visible&&r.y===-.42),'Foreground fully hides after retreat');
        await seek(page,1.2);assert.deepEqual((await poses(page)).rubble,full.rubble,'Foreground supports reverse seek');
        const layout=await page.evaluate(()=>{
            const model=window.__pokemonReveal.debug.model, bounds=[];let plates=0;
            model.traverse(o=>{if(o.name.startsWith('GroundPlate'))plates++;});
            for(let i=0;i<5;i++){
                const m=model.getObjectByName(`GroundPillar${i}`),p=m.geometry.attributes.position,v=m.position.clone();
                m.updateMatrix();let min=Infinity,max=-Infinity,bodyMin=Infinity,bodyMax=-Infinity,frontMin=Infinity;
                for(let j=0;j<p.count;j++){
                    v.fromBufferAttribute(p,j).applyMatrix4(m.matrix);if(v.y<-.11)continue;
                    min=Math.min(min,v.x);max=Math.max(max,v.x);
                    if(v.y>.15){bodyMin=Math.min(bodyMin,v.x);bodyMax=Math.max(bodyMax,v.x);}
                    if(v.z>.38&&v.y>-.03)frontMin=Math.min(frontMin,Math.abs(v.x));
                }
                v.set(0,1,0).applyQuaternion(m.quaternion);
                const tilt=Math.atan2(Math.hypot(v.x,v.z),v.y)*180/Math.PI;
                bounds.push({min,max,bodyMin,bodyMax,frontMin,tilt});
            }
            return {plates,bounds};
        });
        assert.equal(layout.plates,0,'No continuous soil floor');
        assert.ok(layout.bounds.every(b=>b.bodyMax<=-.37||b.bodyMin>=.37),'Card-width corridor above the bases');
        assert.ok(layout.bounds.every(b=>b.frontMin>=.37),'No rock intersects the front card corridor');
        assert.ok(layout.bounds.every(b=>b.min>=-.93&&b.max<=.93),'Crown stays inside bowl width');
        assert.ok(layout.bounds.every(b=>b.tilt>=12&&b.tilt<=26),'Visible multidirectional lean');
        const foreground=await page.evaluate(()=>Array.from({length:6},(_,i)=>{
            const m=window.__pokemonReveal.debug.model.getObjectByName(`GroundRubble${i}`),matrix=m.matrix.clone();
            m.getMatrixAt(0,matrix);const v=m.position.clone(),a=m.geometry.attributes.position;
            let top=-Infinity;for(let j=0;j<a.count;j++){v.fromBufferAttribute(a,j).applyMatrix4(matrix);top=Math.max(top,v.y);}
            return {x:matrix.elements[12],z:matrix.elements[14],top};
        }));
        assert.equal(foreground.filter(b=>b.z>.65).length,4,'Four low boulders along the front rim');
        assert.ok(foreground.every(b=>Math.hypot(b.x,b.z)>.82&&Math.hypot(b.x,b.z)<.91),'Foreground follows the inner Ball rim');
        assert.ok(foreground.every(b=>b.top<.22),'Foreground stays below card artwork');
        assert.ok(foreground.filter(b=>Math.abs(b.x)<.25).every(b=>b.top<.05),'Center boulders remain low');
        assert.ok(foreground.every(b=>b.top-.42<-.11),'Boulders fully submerge before being hidden');
        for(const time of [1.8,2.1,2.15]){
            await seek(page,time);assert.deepEqual((await poses(page)).pillars,full.pillars,'Hold crown through silhouette materialization');
            assert.deepEqual((await poses(page)).rubble,full.rubble,'Hold foreground through silhouette materialization');
        }
        await seek(page,2.4); const retreat=await poses(page);
        full.pillars.forEach((p,i)=>{assert.deepEqual(p.scale,retreat.pillars[i].scale);assert.ok(retreat.pillars[i].position[1]<p.position[1]);});
        await seek(page,3.05);assert.ok((await poses(page)).pillars.every(p=>!p.visible),'Retreat completes by 3.05s');
        await seek(page,1.2); assert.deepEqual(await poses(page),full,'Deterministic reverse seek');
        const motion=[];
        for(const t of [0.70,0.72,0.74]) {await seek(page,t);motion.push((await poses(page)).debris);}
        let ballistic=0;
        for(let i=0;i<motion[0].length;i++)if(motion.every(a=>a[i][13]>-1)) {
            assert.ok(Math.abs((motion[0][i][13]-2*motion[1][i][13]+motion[2][i][13])/0.0004+4.3)<0.01);
            ballistic++;
        }
        assert.ok(ballistic>=5);
        const debrisSizes=await page.evaluate(()=>{
            const sizes=[];
            for(let i=0;i<6;i++){
                const m=window.__pokemonReveal.debug.model.getObjectByName(`GroundDebris${i}`),matrix=m.matrix.clone();
                const p=m.position.clone(),s=p.clone(),q=m.quaternion.clone();
                for(let j=0;j<m.count;j++){m.getMatrixAt(j,matrix);matrix.decompose(p,q,s);sizes.push(s.x);}
            }
            return sizes;
        });
        assert.ok(debrisSizes.every(s=>s>=.0319&&s<=.0721)&&debrisSizes.filter(s=>s>.045).length>fragments/3,'Readable debris sizes in both device pools');
        const bytes=await readFile(`src/assets/mist-replay/ground-${profile}.bin`);
        const header=parseSmokeClip(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)).header;
        assert.ok(header.sources['groundEvents.ts']);
        for(const frame of [30,72,108,144,180]) {
            await seek(page,frame/60);
            const hashes=await page.evaluate(async()=>{
                const d=window.__pokemonReveal.debug, hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
                return [await hash(d.replayFrameData()),await hash(d.readSmokeField())];
            });
            assert.deepEqual(hashes,Array(2).fill(header.profile.chunks[Math.floor(frame/4)].frames[frame%4].densitySHA256));
        }
        await page.evaluate(()=>window.__pokemonReveal.debug.clearSmokeReadback());
        for(const side of [false,true]) {
            await page.evaluate(side=>window.__pokemonReveal.debug.sideView(side),side);
            for(const time of [0.3,0.7,1.2,1.8,2.1,2.4,2.7,3.05,3.5]) {await seek(page,time);await page.screenshot({path:path.join(out,`${profile}-${side?'side':'front'}-${time}.png`)});}
            if(process.argv.includes('--motion'))for(const rate of [1,0.2])await record(page,profile,side,rate);
        }
        await seek(page,3.5); assert.equal((await state(page)).ground.live,0);assert.equal((await state(page)).cardScale,0.94);
        assert.ok((await poses(page)).pillars.every(p=>!p.visible));
        const crumbs=await page.evaluate(()=>Array.from({length:6},(_,i)=>{
            const m=window.__pokemonReveal.debug.model.getObjectByName(`GroundRubble${i}`),matrix=m.matrix.clone();
            m.getMatrixAt(0,matrix);const p=m.position.clone(),s=p.clone(),q=m.quaternion.clone();matrix.decompose(p,q,s);
            return {x:p.x,size:Math.max(...s.toArray()),visible:m.visible};
        }));
        assert.equal(crumbs.filter(c=>c.x<0).length,3);assert.equal(crumbs.filter(c=>c.x>0).length,3);
        assert.ok(crumbs.every(c=>!c.visible),'No crumbs remain after reveal');
        await seek(page,1.2);
        assert.ok(await page.evaluate(()=>Array.from({length:6},(_,i)=>window.__pokemonReveal.debug.model.getObjectByName(`GroundRubble${i}`).visible).every(Boolean)),'Reverse seek restores temporary crumbs');
        await seek(page,3.5);
        const memory=(await state(page)).memory;
        for(let i=0;i<3;i++){await page.evaluate(()=>window.__pokemonReveal.play('ground'));await seek(page,3.5);}
        assert.deepEqual((await state(page)).memory,memory,'No resource growth on restart');
        await page.setViewportSize({width:width+40,height:760});await seek(page,1.2);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
        assert.equal((await state(page)).running,false);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
        await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.__pokemonReveal.play('ground'));
        assert.equal((await state(page)).time,3.5);await page.emulateMedia({reducedMotion:'no-preference'});
        await page.evaluate(()=>window.__pokemonReveal.play('water'));await seek(page,1.2);assert.equal((await state(page)).effect,'WaterEffect');
        await page.locator('#pokemon-name').fill('Sandshrew');await page.locator('#pokemon-search button').click();
        await page.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().effect==='GroundEffect');await seek(page,3.5);
        await page.evaluate(()=>window.__pokemonReveal.dispose());const disposed=await state(page);
        assert.equal(disposed.disposed,true);assert.equal(disposed.memory.geometries,0);
        assert.equal(disposed.mist.replay.dataBytes,0);assert.equal(disposed.mist.replay.decodedBytes,0);
        assert.ok(disposed.memory.textures<=2);
        await page.waitForFunction(()=>document.querySelector('canvas').getContext('webgl2').isContextLost());
        await page.context().close();report.profiles.push({profile,hulls,ballistic,fragments,layout,foreground,crumbs});console.log('Passed',profile);
    }
    const fallback=await setup(600);
    await fallback.route(clips,route=>isClip(route)?route.fulfill({body:Buffer.from('invalid replay')}):route.continue());
    await open(fallback);assert.equal((await state(fallback)).mist.source,'live');assert.equal((await state(fallback)).mist.variant,'ground');
    await fallback.evaluate(()=>window.__pokemonReveal.dispose());await fallback.context().close();
    for(const action of ['switch','dispose']) {
        const page=await setup(600);await open(page,'water');
        let signal;const requested=new Promise(r=>{signal=r;});
        await page.route(clips,async route=>{if(!isClip(route))return route.continue();signal();await new Promise(r=>setTimeout(r,400));await route.continue().catch(()=>{});});
        await page.evaluate(()=>{window.pendingGround=window.__pokemonReveal.play('ground');});await requested;
        if(action==='switch')await page.evaluate(()=>window.__pokemonReveal.play('water'));else await page.evaluate(()=>window.__pokemonReveal.dispose());
        await page.evaluate(()=>window.pendingGround);const s=await state(page);
        if(action==='switch')assert.equal(s.effect,'WaterEffect');else assert.equal(s.disposed,true);
        await page.evaluate(()=>window.__pokemonReveal.dispose());await page.context().close();
    }
    for(const action of ['switch','dispose']) {
        const page=await setup(600);await open(page,'water');
        let signal;const requested=new Promise(r=>{signal=r;});
        await page.route('**/textures/ground/*',async route=>{signal();await new Promise(r=>setTimeout(r,500));await route.continue().catch(()=>{});});
        await page.evaluate(()=>{window.pendingGround=window.__pokemonReveal.play('ground');});await requested;
        if(action==='switch')await page.evaluate(()=>window.__pokemonReveal.play('water'));else await page.evaluate(()=>window.__pokemonReveal.dispose());
        await page.evaluate(()=>window.pendingGround);const s=await state(page);
        if(action==='switch')assert.equal(s.effect,'WaterEffect');else {assert.equal(s.disposed,true);assert.ok(s.memory.textures<=2);}
        await page.evaluate(()=>window.__pokemonReveal.dispose());await page.context().close();
    }
    report.scenarios.push('Angled textured rocks, open card corridor, no floor, silhouette hold, late retreat, clean final bowl, forward/reverse seek, gravity, replay hashes, restart, resize, visibility, reduced motion, search form, fallback, interrupted replay/texture prepare, disposal');
    assert.deepEqual(report.errors,[]);report.passed=true;
} finally {await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();console.log(out);}
