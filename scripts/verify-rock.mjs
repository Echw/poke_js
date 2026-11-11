import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';
import { revealTypeForCard } from '../src/data/revealType.ts';
import { ROCK_POSES, rockPosition } from '../src/effects/rockMotion.ts';
import { Vector3 } from 'three';

const out = process.env.ROCK_QA_DIR || path.join(os.tmpdir(), 'rock-reveal-qa');
const base = process.env.ROCK_QA_URL || 'http://127.0.0.1:5176';
await mkdir(out, { recursive: true });
const report = { out, errors: [], profiles: [], passed: false };
const browser = await launch();
const card = { id: 'base3-47', name: 'Geodude', image: 'https://assets.tcgdex.net/en/base/base3/47', types: ['Fighting'], dexId: [74] };
const artwork = await readFile('public/textures/geodude-preview.webp');
try {
    for (const [name, dex, expected] of [['Geodude',74,'rock'],['Onix',95,'rock'],['Sudowoodo',185,'rock'],
        ['Alolan Geodude',74,'rock'],['Rhyhorn',111,'ground'],['Machop',66,'fighting'],['Sandshrew',27,'ground']]) {
        for (const dexId of [[dex], []]) assert.equal(revealTypeForCard({ ...card, name, dexId }), expected, name);
    }
    // A continuous deterministic route is required for seeking, interruption and replay.
    const p = new Vector3(), before = new Vector3(), after = new Vector3();
    for (let i = 0; i < ROCK_POSES.length; i++) {
        for (let t = 0.01; t <= 3.5; t += 0.01) {
            rockPosition(before, i, t - 0.0001); rockPosition(after, i, t + 0.0001);
            assert.ok(before.distanceTo(after) < 0.001, `Continuous boulder ${i} at ${t}`);
        }
        rockPosition(p, i, 1.25); rockPosition(after, i, 3.5); rockPosition(after, i, 1.25);
        assert.deepEqual(p.toArray(), after.toArray());
        rockPosition(before, i, 0.2); assert.ok(p.y > before.y + 0.3, 'Clear lift above the bed');
        for (const t of [1.35,1.6,1.95]) {
            rockPosition(before, i, t); rockPosition(after, i, 1.34);
            assert.deepEqual(before.toArray(),after.toArray(),'Holds its destination without a second sideways move or drift');
        }
        rockPosition(after, i, 2.65);
        assert.ok(Math.abs(after.x-ROCK_POSES[i].target[0])<1e-12,'Landing keeps its horizontal position');
        assert.ok(Math.abs(after.z-ROCK_POSES[i].target[2])<1e-12,'Landing keeps its depth');
        rockPosition(after, i, 2.9); assert.ok(after.y < p.y - 0.25, 'Returns into the bowl');
    }
    for (const [profile, width, height] of [['desktop',1280,900],['mobile',390,844]]) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        const page = await context.newPage(); await isolate(page);
        page.on('pageerror', e => report.errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' && /THREE|GLSL|WebGL|shader/i.test(m.text())) report.errors.push(m.text()); });
        await page.route('https://api.tcgdex.net/**', r => r.fulfill({ json: r.request().url().includes('?') ? [card] : card }));
        await page.route('https://assets.tcgdex.net/**', r => r.fulfill({ contentType: 'image/webp', body: artwork }));
        await page.goto(`${base}/?reveal=rock`);
        await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 60000 });
        await seek(page, 1.25);
        assert.equal((await state(page)).effect, 'RockEffect');
        assert.equal((await state(page)).rock.chips, profile === 'mobile' ? 30 : 48);
        await seek(page,0.82);
        const lateral = await page.evaluate(() => {
            const model=window.__pokemonReveal.debug.model, result={left:0,right:0};
            for(let i=0;i<3;i++) {
                const mesh=model.getObjectByName(`RockChips${i}`), matrix=mesh.matrix.clone();
                for(let j=0;j<mesh.count;j++) {
                    mesh.getMatrixAt(j,matrix);
                    if(matrix.elements[13]<-0.17)continue;
                    if(matrix.elements[12]<-0.60)result.left++;
                    if(matrix.elements[12]>0.60)result.right++;
                }
            }
            return result;
        });
        assert.ok(lateral.left>=3&&lateral.right>=3,'Visible chips shoot out to both sides');
        await seek(page,1.25);
        const hulls = await page.evaluate(async () => {
            const THREE = await import('/node_modules/three/build/three.module.js');
            return Array.from({ length: 4 }, (_, i) => {
                const m = window.__pokemonReveal.debug.model.getObjectByName(`RockBoulder${i}`), g = m.geometry;
                const p = g.attributes.position, ix = g.index, edges = new Map(), bounds = new THREE.Box3().setFromBufferAttribute(p);
                let volume = 0; const a = new THREE.Vector3(), b = a.clone(), c = a.clone();
                for (let j = 0; j < ix.count; j += 3) {
                    const ids = [ix.getX(j),ix.getX(j+1),ix.getX(j+2)];
                    a.fromBufferAttribute(p,ids[0]); b.fromBufferAttribute(p,ids[1]); c.fromBufferAttribute(p,ids[2]); volume += a.dot(b.cross(c))/6;
                    for (let k=0;k<3;k++) { const key=[ids[k],ids[(k+1)%3]].sort((a,b)=>a-b).join(':'); edges.set(key,(edges.get(key)||0)+1); }
                }
                return { closed:[...edges.values()].every(n=>n===2),volume,size:bounds.getSize(a).toArray(),
                    roughness:m.material.roughness,metalness:m.material.metalness,opaque:!m.material.transparent&&m.material.opacity===1,
                    geometry:g.uuid,material:m.material.uuid };
            });
        });
        assert.ok(hulls.every(h => h.closed && h.volume > 0 && Math.min(...h.size) > 0.65 && h.roughness > 0.9 && h.metalness === 0 && h.opaque));
        assert.equal(new Set(hulls.map(h => h.geometry)).size,4); assert.equal(new Set(hulls.map(h => h.material)).size,1);
        const poses = () => page.evaluate(() => Array.from({length:4},(_,i) => {
            const m=window.__pokemonReveal.debug.model.getObjectByName(`RockBoulder${i}`);
            return {p:m.position.toArray(),q:m.quaternion.toArray(),s:m.scale.toArray()};
        }));
        const held = await poses(); await seek(page,2.75); await seek(page,1.25); assert.deepEqual(await poses(),held);
        for (const t of [1.75,1.95,2.15,2.5,2.8,3.1,3.5]) {
            await seek(page,t);
            const intersections = await page.evaluate(async () => {
                const THREE = await import('/node_modules/three/build/three.module.js');
                const model=window.__pokemonReveal.debug.model;
                const card=model.children.find(o=>o.isMesh&&Array.isArray(o.material)&&o.material.length===6);
                model.updateWorldMatrix(true,true);
                const inv=card.matrixWorld.clone().invert(), p=new THREE.Vector3(); let count=0;
                for(let i=0;i<4;i++) {
                    const m=model.getObjectByName(`RockBoulder${i}`), a=m.geometry.attributes.position;
                    const matrix=inv.clone().multiply(m.matrixWorld);
                    for(let j=0;j<a.count;j++) {
                        p.fromBufferAttribute(a,j).applyMatrix4(matrix);
                        if(Math.abs(p.x)<0.35&&Math.abs(p.y)<0.50&&Math.abs(p.z)<0.012)count++;
                    }
                }
                return count;
            });
            assert.equal(intersections,0,`Boulders clear the card surface at ${t}`);
        }
        for (const side of [false,true]) {
            await page.evaluate(side => window.__pokemonReveal.debug.sideView(side), side);
            for (const t of [0.3,0.73,1.28,1.95,2.5,3.5]) {
                await seek(page,t); await page.screenshot({path:path.join(out,`${profile}-${side?'side':'front'}-${t}.png`)});
            }
        }
        await page.evaluate(() => window.__pokemonReveal.debug.sideView(false));
        if(process.argv.includes('--motion')) {
            await seek(page,0);
            await page.evaluate(() => {
                window.rockChunks=[]; window.rockStream=document.querySelector('canvas').captureStream(60);
                window.rockRecorder=new MediaRecorder(window.rockStream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:6000000});
                window.rockRecorder.ondataavailable=e=>{if(e.data.size)window.rockChunks.push(e.data)};window.rockRecorder.start();
                window.__pokemonReveal.debug.resume(0.5);
            });
            await page.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().time===3.5,null,{timeout:20000});
            const video=await page.evaluate(async()=>{
                await new Promise(resolve=>{window.rockRecorder.onstop=resolve;window.rockRecorder.stop()});
                window.rockStream.getTracks().forEach(t=>t.stop());
                return Array.from(new Uint8Array(await new Blob(window.rockChunks,{type:'video/webm'}).arrayBuffer()));
            });
            await writeFile(path.join(out,`${profile}-motion.webm`),Buffer.from(video));
        }
        await seek(page,3.5);
        const finish = await state(page); assert.equal(finish.cardScale,1.18); assert.ok(finish.rock.finished);
        const stoneState = () => page.evaluate(() => {
            const result={boulders:0,rubble:0,chips:0,bedY:[]};
            window.__pokemonReveal.debug.model.getObjectByName('RockEffect').traverse(o=>{
                if(o.name.startsWith('RockBoulder')&&o.visible)result.boulders++;
                if(o.name.startsWith('RockBed')) { if(o.visible)result.rubble++;result.bedY.push(o.position.y); }
                if(o.name.startsWith('RockChips')&&o.visible)result.chips++;
            });
            return result;
        });
        let stones=await stoneState();
        assert.equal(stones.boulders+stones.rubble+stones.chips,0,'No stones remain after completion');
        await seek(page,2.8); stones=await stoneState();
        assert.equal(stones.rubble,3);assert.ok(stones.bedY.every(y=>y<0&&y>-.24),'Rubble progressively sinks');
        await seek(page,3.2);stones=await stoneState();
        assert.equal(stones.boulders+stones.rubble,0,'Large stones and rubble disappear before completion');
        await seek(page,1.25);stones=await stoneState();
        assert.equal(stones.boulders,4);assert.equal(stones.rubble,3);
        assert.ok(stones.bedY.every(y=>y===0),'Reverse seek restores stones and bed height');
        await seek(page,3.5);
        const memory = finish.memory;
        for (let i=0;i<3;i++) { await page.evaluate(() => window.__pokemonReveal.play('rock')); await seek(page,3.5); }
        assert.deepEqual((await state(page)).memory,memory,'Replay does not grow GPU resources');
        await page.evaluate(() => window.__pokemonReveal.play('rock')); await seek(page,1.1);
        await page.evaluate(() => window.__pokemonReveal.stop()); assert.equal((await state(page)).running,false);
        await page.evaluate(() => window.__pokemonReveal.play('water')); await seek(page,1.2); assert.equal((await state(page)).effect,'WaterEffect');
        await page.locator('#pokemon-name').fill('Geodude'); await page.locator('#pokemon-search button').click();
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().effect === 'RockEffect'); await seek(page,3.5);
        const fit = await page.evaluate(() => ({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight}));
        assert.ok(fit.sw<=fit.w&&fit.sh<=fit.h,'Viewport fits scene and controls');
        await page.emulateMedia({reducedMotion:'reduce'}); await page.evaluate(() => window.__pokemonReveal.play('rock'));
        assert.equal((await state(page)).time,3.5);
        await page.evaluate(() => window.__pokemonReveal.dispose()); const disposed = await state(page);
        assert.ok(disposed.disposed); assert.equal(disposed.memory.geometries,0);
        await context.close(); report.profiles.push({profile,hulls,fit});
    }
    assert.deepEqual(report.errors,[]); report.passed = true;
} finally {
    await browser.close(); await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
console.log(`Rock routing, closed mineral hulls, motion, desktop/mobile phases, search, interruption, replay, reduced motion and disposal passed. ${out}`);
