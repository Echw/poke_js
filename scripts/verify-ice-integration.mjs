import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { launch, state, seek, isolate } from './ice-test-fixture.mjs';
import { smokeSourceTime, smokeSourceFrame } from '../src/effects/smokeTiming.ts';
import { parseSmokeClip } from '../src/effects/smokeClipFormat.ts';
const headers={};
for(const name of ['desktop','mobile']){
    const bytes=await readFile(`src/assets/mist-replay/ice-${name}.bin`);
    headers[name]=parseSmokeClip(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)).header;
}
const m={profiles:Object.fromEntries(Object.entries(headers).map(([name,header])=>[name,header.profile]))};
const clipRequest=/\/ice-(desktop|mobile)[^/]*\.bin(?:\?.*)?$/;
const isClip=route=>!/[?&](url|import)(?:[=&]|$)/.test(route.request().url());
const out=process.env.ICE_QA_DIR||path.join(os.tmpdir(),`poke-ice-qa-${Date.now()}`);await mkdir(out,{recursive:true});
const browser=await launch(),report={out,fields:[],scenarios:[],performance:[],errors:[]};
async function open(width,height,suffix=''){
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    const page=await context.newPage();await isolate(page);
    page.on('pageerror',error=>report.errors.push(error.message));
    page.on('console',msg=>{if(msg.type()==='error'&&/THREE|GLSL|WebGL|shader/i.test(msg.text()))report.errors.push(msg.text())});
    await page.goto(`http://127.0.0.1:5173/?reveal=ice${suffix}`);
    await page.waitForFunction(()=>window.__pokemonReveal?.debug,null,{timeout:120000});
    await page.waitForFunction(()=>document.querySelector('#summon-status').textContent==='',null,{timeout:120000});
    await page.evaluate(()=>window.__pokemonReveal.stop());
    return page;
}
try{
    assert.equal(smokeSourceTime(0.8),0.8);assert.ok(Math.abs(smokeSourceTime(3.5)-6)<1e-10);
    if(!process.argv.includes('--extra')&&!process.argv.includes('--production')&&!process.argv.includes('--authoring')){
    for(const [name,width,height]of[['desktop',1280,800],['mobile',600,800]]){
        const page=await open(width,height),p=m.profiles[name];
        assert.equal(await page.locator('aside').count(),0);assert.equal((await state(page)).duration,3.5);
        for(let frame=0;frame<211;frame++){
            await seek(page,frame/60);
            const hashes=await page.evaluate(async()=>{
                const d=window.__pokemonReveal.debug;
                const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
                return {cpu:await sha(d.replayFrameData()),gpu:await sha(d.readSmokeField())};
            });
            const expected=p.chunks[Math.floor(frame/4)].frames[frame%4];
            assert.equal(hashes.cpu,expected.densitySHA256);assert.equal(hashes.gpu,expected.densitySHA256);
            assert.equal(expected.sourceFrame,smokeSourceFrame(frame));
            report.fields.push({name,frame,sourceFrame:expected.sourceFrame,hash:hashes.gpu});
            if(frame%70===0)console.log(`${name}: ${frame}/210 FP16 CPU/GPU exact`);
        }
        await page.evaluate(()=>window.__pokemonReveal.debug.clearSmokeReadback());
        for(const time of [.2,.4,.8,1.1,1.8,2.2,2.8,3.3,3.5])for(const side of[false,true]){
            await seek(page,time);await page.evaluate(side=>window.__pokemonReveal.debug.sideView(side),side);
            await page.screenshot({path:path.join(out,`${name}-${side?'side':'front'}-${time}.png`)});
            const s=await state(page);assert.equal(s.mist.source,'replay');assert.equal(s.mist.simulation,undefined);
            if(time===3.5)assert.equal(s.mist.visible,false);
        }
        await page.evaluate(async()=>{
            window.__pokemonReveal.debug.sideView(false);await window.__pokemonReveal.debug.seek(2.8);
            const canvas=document.querySelector('canvas'),scratch=new OffscreenCanvas(canvas.width,canvas.height),ctx=scratch.getContext('2d');
            ctx.drawImage(canvas,0,0);window.rewindImage=ctx.getImageData(0,0,canvas.width,canvas.height).data;
            window.rewindField=window.__pokemonReveal.debug.replayFrameData().slice();
        });
        const rewind=await page.evaluate(async()=>{
            const d=window.__pokemonReveal.debug;await d.seek(.4);await d.seek(2.8);
            const canvas=document.querySelector('canvas'),scratch=new OffscreenCanvas(canvas.width,canvas.height),ctx=scratch.getContext('2d');
            ctx.drawImage(canvas,0,0);const image=ctx.getImageData(0,0,canvas.width,canvas.height).data;
            let max=0;for(let i=0;i<image.length;i++)max=Math.max(max,Math.abs(image[i]-window.rewindImage[i]));
            const field=window.__pokemonReveal.debug.replayFrameData();return {max,exact:field.every((v,i)=>v===window.rewindField[i])};
        });
        // Rasterization at crystal silhouettes may differ by one output byte;
        // replay fields must remain bit-exact regardless of seek direction.
        assert.ok(rewind.exact);assert.ok(rewind.max<=1,`Rewind RGB error ${rewind.max}`);
        const uploads=(await state(page)).mist.replay.uploads;await seek(page,2.801);assert.equal((await state(page)).mist.replay.uploads,uploads);
        await page.setViewportSize({width:width-15,height:height-15});await seek(page,1.4);await page.setViewportSize({width,height});
        for(const type of['water','grass','psychic','fire','electric','ice']){
            await page.evaluate(async type=>{const s=window.__pokemonReveal;await s.play(type);await s.debug.seek(1.4)},type);
            assert.ok((await state(page)).effect.toLowerCase().includes(type));
        }
        await page.evaluate(async()=>{const d=window.__pokemonReveal.debug;await d.setMistSource('live');await d.seek(1.8)});
        const gpu=await page.evaluate(async()=>{const d=window.__pokemonReveal.debug;const b=d.readSmokeField();return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('')});
        const frame=108;assert.equal(gpu,p.chunks[Math.floor(frame/4)].frames[frame%4].sourceSHA256,'Live fallback uses the original retimed field');
        await page.evaluate(()=>window.__pokemonReveal.debug.setMistSource('replay'));
        await page.evaluate(()=>{window.__pokemonReveal.dispose();window.__pokemonReveal.dispose()});
        const disposed=await state(page);assert.equal(disposed.memory.geometries,0);assert.equal(disposed.mist.replay.dataBytes,0);
        report.scenarios.push({name,rewind:true,resize:true,effects:true,fallback:true,disposed:disposed.memory});await page.context().close();
    }
    const page=await open(1920,1080);await seek(page,3.3);await seek(page,0);
    await page.evaluate(()=>{const d=window.__pokemonReveal.debug;d.setSmokeFrameTiming(true);d.resetSmokeTiming();d.resume(1)});
    const start=Date.now();await page.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().time===3.5,null,{timeout:15000});
    const final=await state(page);report.performance.push({wallMs:Date.now()-start,snapshot:final,hardware:await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2');return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)})});
    assert.ok(report.performance[0].wallMs<3900,'Retimed playback must not stall');
    assert.ok(final.frameGpu.count>60);console.log('Full HD GPU',JSON.stringify(final.frameGpu.frameMs),'wall',report.performance[0].wallMs);
    assert.ok(final.frameGpu.frameMs.p95<=16.7,'Full-scene GPU p95 budget');
    await page.evaluate(()=>window.__pokemonReveal.dispose());await page.context().close();
    }
    if(!process.argv.includes('--production')&&!process.argv.includes('--authoring')){
    // Cold selection may finish loading after a different Pokémon has been selected.
    const raceContext=await browser.newContext({viewport:{width:1280,height:800}}),race=await raceContext.newPage();await isolate(race);
    await race.route(clipRequest,async route=>{if(isClip(route))await new Promise(resolve=>setTimeout(resolve,500));await route.continue()});
    await race.goto('http://127.0.0.1:5173/?reveal=water');await race.waitForFunction(()=>window.__pokemonReveal?.debug);
    await race.evaluate(async()=>{const s=window.__pokemonReveal;const first=s.play('ice');await s.play('water');await first;s.stop()});
    assert.match((await state(race)).effect,/Water/);report.scenarios.push({selectionDuringPreparation:true});
    await race.evaluate(async()=>{const s=window.__pokemonReveal;await s.play('ice');await s.debug.seek(1);s.debug.resume(.2);
        Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
    const hidden=await state(race);await race.waitForTimeout(150);assert.equal((await state(race)).time,hidden.time);
    await race.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});
    await race.waitForTimeout(150);assert.ok((await state(race)).time>hidden.time);
    await race.evaluate(()=>window.__pokemonReveal.dispose());await raceContext.close();report.scenarios.push({visibilityEventContract:true});
    for(const fault of['missing','corrupt','header','truncated']){
        const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();await isolate(page);
        await page.route(clipRequest,async route=>{
            if(!isClip(route))return route.continue();
            if(fault==='missing')return route.fulfill({status:404,body:'test'});
            const response=await route.fetch();let data=await response.body();
            if(fault==='truncated')data=data.subarray(0,data.length-1);
            else if(fault==='header'){
                const position=data.indexOf(Buffer.from('"maxDensity":3'));assert.ok(position>0);
                data[position+'"maxDensity":'.length]='2'.charCodeAt(0);
            }else data[data.length-1]^=1;
            await route.fulfill({response,body:data});
        });
        await page.goto('http://127.0.0.1:5173/?reveal=ice');await page.waitForFunction(()=>window.__pokemonReveal?.debug,null,{timeout:120000});
        assert.equal((await state(page)).mist.source,'live');assert.ok((await state(page)).mist.fallbackReason);
        await page.evaluate(()=>window.__pokemonReveal.dispose());await context.close();report.scenarios.push({fault,fallback:true});
    }
    // Delay one inflation inside the worker; loading assets before playback is unaffected.
    const delayedContext=await browser.newContext({viewport:{width:1280,height:800}}),delayed=await delayedContext.newPage();await isolate(delayed);
    await delayed.route(/\/src\/effects\/smokeReplayWorker\.ts(?:\?.*)?$/,async route=>{
        const response=await route.fetch(),body=await response.text();assert.ok(body.includes('const decodeStart = performance.now();'));
        await route.fulfill({response,body:body.replace('const decodeStart = performance.now();','if(chunk.first===8)await new Promise(resolve=>setTimeout(resolve,700));const decodeStart = performance.now();')});
    });
    await delayed.goto('http://127.0.0.1:5173/?reveal=ice');await delayed.waitForFunction(()=>window.__pokemonReveal?.debug,null,{timeout:120000});
    await delayed.evaluate(()=>window.__pokemonReveal.stop());await seek(delayed,0);
    await delayed.evaluate(()=>window.__pokemonReveal.debug.resume(1));await delayed.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().buffering);
    const buffering=await state(delayed);await delayed.waitForTimeout(100);assert.equal((await state(delayed)).time,buffering.time);
    await delayed.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().time>.4);await delayed.evaluate(()=>window.__pokemonReveal.dispose());await delayedContext.close();
    report.scenarios.push({underflowPausesWholeTimeline:true});
    const cancelContext=await browser.newContext({viewport:{width:1280,height:800}}),cancel=await cancelContext.newPage();await isolate(cancel);
    cancel.on('pageerror',error=>report.errors.push(error.message));
    await cancel.route(/\/src\/scene\/scene\.ts(?:\?.*)?$/,async route=>{
        const response=await route.fetch(),body=await response.text(),needle='await renderer.compileAsync(ice.root, camera, scene);';
        assert.ok(body.includes(needle));
        // A statement block also supports the host's single-statement if/else warmup.
        await route.fulfill({response,body:body.replace(needle,'{'+needle+'window.waitingForIceCompile=true;await new Promise(resolve=>setTimeout(resolve,300));}')});
    });
    await cancel.goto('http://127.0.0.1:5173/?reveal=water');await cancel.waitForFunction(()=>window.__pokemonReveal?.debug);
    await cancel.evaluate(()=>{window.pendingIce=window.__pokemonReveal.play('ice')});
    await cancel.waitForFunction(()=>window.waitingForIceCompile);await cancel.evaluate(()=>window.__pokemonReveal.dispose());
    await cancel.evaluate(()=>window.pendingIce);assert.equal((await state(cancel)).memory.geometries,0);
    await cancelContext.close();report.scenarios.push({disposeDuringWarmup:true});
    }
    if(process.argv.includes('--authoring')){
        const page=await open(1280,800,'&smokeSource=live');
        for(const frame of[0,108,210]){
            const sourceFrame=smokeSourceFrame(frame);
            const hash=await page.evaluate(async sourceFrame=>{
                const data=window.__pokemonReveal.debug.exportMistFrame(sourceFrame);
                return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
            },sourceFrame);
            assert.equal(hash,m.profiles.desktop.chunks[Math.floor(frame/4)].frames[frame%4].sourceSHA256);
        }
        await page.evaluate(()=>window.__pokemonReveal.dispose());await page.context().close();report.scenarios.push({offlineAuthoringDensityExport:true});
    }
    if(process.argv.includes('--production')){
        const mobile=process.argv.includes('--mobile');
        const context=await browser.newContext({viewport:{width:mobile?600:1280,height:800}}),page=await context.newPage();
        page.on('pageerror',e=>report.errors.push(e.message));
        await page.addInitScript(()=>{
            window.iceQA={solverShaders:0,queries:0,smokeWorkers:0,lastDraw:0};
            const shader=WebGL2RenderingContext.prototype.shaderSource;
            WebGL2RenderingContext.prototype.shaderSource=function(s,code){if(/#define PASS_(PRESSURE|DENSITY_CORRECT)\b/.test(code))window.iceQA.solverShaders++;return shader.call(this,s,code)};
            const query=WebGL2RenderingContext.prototype.beginQuery;
            WebGL2RenderingContext.prototype.beginQuery=function(...args){window.iceQA.queries++;return query.apply(this,args)};
            const draw=WebGL2RenderingContext.prototype.drawElements;
            WebGL2RenderingContext.prototype.drawElements=function(...args){window.iceQA.lastDraw=performance.now();return draw.apply(this,args)};
            const worker=window.Worker;window.Worker=class extends worker{constructor(url,options){super(url,options);if(String(url).includes('smokeReplayWorker'))window.iceQA.smokeWorkers++;}};
        });
        const cards=[['Squirtle','Water',7],['Bulbasaur','Grass',1],['Charmander','Fire',4],['Pikachu','Lightning',25],['Abra','Psychic',63],['Glaceon','Water',471],['Machop','Fighting',66]];
        await page.route('https://api.tcgdex.net/**',route=>{
            const url=new URL(route.request().url()),query=url.searchParams.get('name');
            const key=query||url.pathname.split('/').pop().replace('mock-','');
            const card=cards.find(c=>c[0].toLowerCase()===key.toLowerCase())||cards[4];
            const brief={id:`mock-${card[0]}`,name:card[0],image:'https://fixture.invalid/card'};
            return route.fulfill({contentType:'application/json',body:JSON.stringify(query?[brief]:{...brief,types:[card[1]],dexId:[card[2]]})});
        });
        const artwork=await readFile('public/textures/glaceon-preview.webp');
        await page.route('https://fixture.invalid/**',route=>route.fulfill({contentType:'image/webp',body:artwork}));
        const loaded=[];page.on('request',request=>{if(/\/(ice|fighting)-(desktop|mobile)[^/]*\.bin(?:\?.*)?$/.test(request.url()))loaded.push(request.url())});
        await page.goto(process.env.ICE_PRODUCTION_URL||'http://127.0.0.1:5175/');
        await page.waitForFunction(()=>document.querySelector('#summon-status').textContent==='');
        assert.equal(await page.evaluate(()=>typeof window.__pokemonReveal),'undefined');
        for(const [name]of cards){
            await page.locator('#pokemon-name').fill(name);await page.locator('#pokemon-search button').click();
            await page.waitForFunction(()=>!document.querySelector('#pokemon-search button').disabled&&document.querySelector('#summon-status').textContent==='',null,{timeout:120000});
            assert.equal(await page.locator('aside').count(),0);
            if(name==='Glaceon'||name==='Machop'){
                const begin=await page.evaluate(()=>performance.now());
                // Capturing a moving canvas can stall headless presentation. Observe
                // the end of actual drawing first, then save the production result.
                await page.waitForFunction(start=>performance.now()-start>1200&&performance.now()-window.iceQA.lastDraw>180,begin,{timeout:15000});
                const counters=await page.evaluate(()=>window.iceQA);assert.equal(counters.solverShaders,0);assert.equal(counters.queries,0);assert.equal(counters.smokeWorkers,name==='Glaceon'?1:2);
                report.scenarios.push({production:counters,playbackMs:counters.lastDraw-begin,assetRequests:loaded.length});
                console.log('Production',JSON.stringify(report.scenarios.at(-1)));
                assert.ok(counters.lastDraw-begin>3000&&counters.lastDraw-begin<3900);
                assert.equal(loaded.length,name==='Glaceon'?1:2);assert.match(loaded.at(-1),new RegExp(`${name==='Glaceon'?'ice':'fighting'}-${mobile?'mobile':'desktop'}-[\\w-]+\\.bin$`));
                await page.screenshot({path:path.join(out,`production-${name==='Glaceon'?'ice':'fighting'}.png`)});
            }
        }
        await context.close();
    }
    assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(`QA: ${out}`);}
