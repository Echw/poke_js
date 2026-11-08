import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import { launch, isolate, state, seek } from './ice-test-fixture.mjs';
import { parseSmokeClip } from '../src/effects/smokeClipFormat.ts';

const reference=process.env.ICE_CLIP_REFERENCE;
if(!reference)throw new Error('ICE_CLIP_REFERENCE must point to the temporary original FP16 clips');
const out=path.join(os.tmpdir(),`poke-smoke-visual-${Date.now()}`);await mkdir(out,{recursive:true});
const motion=process.argv.includes('--motion');
const browser=await launch(),report={out,fields:[],images:[],motion:[],errors:[]};
try{
    for(const[name,width,height]of[['desktop',1280,800],['mobile',600,800]]){
        const candidateBytes=await readFile(`src/assets/mist-replay/ice-${name}.bin`);
        const {header}=parseSmokeClip(candidateBytes.buffer.slice(candidateBytes.byteOffset,candidateBytes.byteOffset+candidateBytes.length));
        const baselineBytes=await readFile(path.join(reference,`reference-${name}.bin`));
        if(motion){
            for(const label of['reference','candidate'])for(const side of[false,true])for(const rate of[1,.2]){
                const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
                const page=await context.newPage();await isolate(page);
                page.on('pageerror',e=>report.errors.push(e.message));
                if(label==='reference')await page.route(new RegExp(`/ice-${name}[^/]*\\.bin(?:\\?.*)?$`),route=>{
                    const u=new URL(route.request().url());if(u.searchParams.has('url')||u.searchParams.has('import'))return route.continue();
                    return route.fulfill({contentType:'application/octet-stream',body:baselineBytes});
                });
                await page.goto('http://127.0.0.1:5173/?reveal=ice');
                await page.waitForFunction(()=>window.__pokemonReveal?.debug&&document.querySelector('#summon-status').textContent==='',null,{timeout:120000});
                await page.evaluate(()=>window.__pokemonReveal.stop());await seek(page,0);
                await page.evaluate(side=>window.__pokemonReveal.debug.sideView(side),side);
                // Capture the actual WebGL canvas. Headless page screencasting
                // can omit GPU surfaces even when screenshots are correct.
                await page.evaluate(()=>{
                    window.motionChunks=[];window.motionStream=document.querySelector('canvas').captureStream(60);
                    window.motionRecorder=new MediaRecorder(window.motionStream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:8000000});
                    window.motionRecorder.ondataavailable=e=>{if(e.data.size)window.motionChunks.push(e.data)};
                    window.motionRecorder.start();
                });
                const start=Date.now();await page.evaluate(rate=>window.__pokemonReveal.debug.resume(rate),rate);
                await page.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().time===3.5,null,{timeout:60000});
                const snapshot=await state(page);report.motion.push({name,label,side,rate,wallMs:Date.now()-start,snapshot});
                assert.equal(snapshot.mist.source,'replay');assert.equal(snapshot.mist.replay.solverPasses,0);
                assert.ok(snapshot.mist.replay.chunks<=2);assert.equal(snapshot.time,3.5);
                const video=await page.evaluate(async()=>{
                    const recorder=window.motionRecorder;
                    await new Promise(resolve=>{recorder.onstop=resolve;recorder.stop()});
                    window.motionStream.getTracks().forEach(track=>track.stop());
                    const blob=new Blob(window.motionChunks,{type:'video/webm'});
                    return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)});
                });
                await writeFile(path.join(out,`${name}-${label}-${side?'side':'front'}-${rate}x.webm`),Buffer.from(video.split(',')[1],'base64'));
                await page.evaluate(()=>window.__pokemonReveal.dispose());await context.close();
                console.log('Motion',name,label,side?'side':'front',rate,report.motion.at(-1).wallMs);
            }
            continue;
        }
        const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
        const baseline=await context.newPage(),candidate=await context.newPage();
        for(const page of[baseline,candidate]){
            await isolate(page);page.on('pageerror',e=>report.errors.push(e.message));
            page.on('console',m=>{if(m.type()==='error'&&/GLSL|THREE|WebGL|shader/i.test(m.text()))report.errors.push(m.text())});
        }
        await baseline.route(new RegExp(`/ice-${name}[^/]*\\.bin(?:\\?.*)?$`),route=>{
            const u=new URL(route.request().url());if(u.searchParams.has('url')||u.searchParams.has('import'))return route.continue();
            return route.fulfill({contentType:'application/octet-stream',body:baselineBytes});
        });
        for(const page of[baseline,candidate]){
            await page.goto('http://127.0.0.1:5173/?reveal=ice');await page.waitForFunction(()=>window.__pokemonReveal?.debug,null,{timeout:120000});
            await page.evaluate(()=>window.__pokemonReveal.stop());await seek(page,0);
            await page.evaluate(()=>{
                window.clipCompare=new BroadcastChannel('ice-clip-compare');window.clipFrames=new Map();window.clipWaiters=new Map();
                window.clipCompare.onmessage=e=>{const waiter=window.clipWaiters.get(e.data.id);if(waiter){window.clipWaiters.delete(e.data.id);waiter(e.data)}else window.clipFrames.set(e.data.id,e.data)};
                window.captureIce=()=>{
                    const canvas=document.querySelector('canvas');
                    window.scratchIce??=new OffscreenCanvas(canvas.width,canvas.height);
                    const ctx=window.scratchIce.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0);
                    return {screen:ctx.getImageData(0,0,canvas.width,canvas.height).data,fog:window.__pokemonReveal.debug.mistPixels(),width:canvas.width,height:canvas.height};
                };
            });
        }
        assert.equal((await state(baseline)).mist.replay.encodingBits,16);
        assert.equal((await state(candidate)).mist.replay.encodingBits,header.encoding.bits);
        for(let frame=0;frame<211;frame++)for(const side of[false,true]){
            const id=`${frame}-${side}`;
            await baseline.evaluate(async({frame,side,id})=>{const d=window.__pokemonReveal.debug;await d.seek(frame/60);d.sideView(side);window.clipCompare.postMessage({id,...window.captureIce()})},{frame,side,id});
            const result=await candidate.evaluate(async({frame,side,id,expected})=>{
                let a=window.clipFrames.get(id);if(a)window.clipFrames.delete(id);else a=await new Promise(resolve=>window.clipWaiters.set(id,resolve));
                const d=window.__pokemonReveal.debug;await d.seek(frame/60);d.sideView(side);const b=window.captureIce();
                const counts=new Uint32Array(256);let sum=0,samples=0,maximum=0,pixels=0;
                for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
                    const fx=Math.min(a.fog.width-1,Math.floor(x*a.fog.width/a.width)),fy=Math.min(a.fog.height-1,Math.floor((a.height-1-y)*a.fog.height/a.height));
                    const alpha=(fy*a.fog.width+fx)*4+3;if(Math.max(a.fog.pixels[alpha],b.fog.pixels[alpha])===0)continue;
                    pixels++;const i=(y*a.width+x)*4;
                    for(let c=0;c<3;c++){const error=Math.abs(a.screen[i+c]-b.screen[i+c]);counts[error]++;sum+=error;samples++;maximum=Math.max(maximum,error)}
                }
                let total=0,p99=0;for(;p99<255;p99++){total+=counts[p99];if(total>=samples*.99)break;}
                if(samples===0)p99=0;
                let field;
                if(!side){const gpu=d.readSmokeField();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',gpu)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==expected)throw new Error('Decoded GPU field hash mismatch');field=hash;}
                return {mean:samples?sum/samples:0,p99,maximum,pixels,field};
            },{frame,side,id,expected:header.profile.chunks[Math.floor(frame/4)].frames[frame%4].densitySHA256});
            report.images.push({name,frame,side,...result});if(result.field)report.fields.push({name,frame,hash:result.field});
            if([24,66,132,168,200].includes(frame))for(const[p,label]of[[baseline,'reference'],[candidate,'candidate']])await p.screenshot({path:path.join(out,`${name}-${label}-${frame}-${side?'side':'front'}.png`)});
            if(!side&&frame%35===0)console.log(`${name} ${frame}: mean ${result.mean.toFixed(3)}, p99 ${result.p99}`);
        }
        for(const p of[baseline,candidate])await p.evaluate(()=>window.__pokemonReveal.dispose());await context.close();
        await writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));
    }
    report.passed=report.errors.length===0&&(motion?report.motion.length===16:report.images.length===844&&report.images.every(i=>i.mean<=1&&i.p99<=3));
    if(motion)console.log('Motion recordings',report.motion.length,report.passed);
    else console.log('Image gate',report.passed,'worst mean',Math.max(...report.images.map(i=>i.mean)),'p99',Math.max(...report.images.map(i=>i.p99)));
    assert.ok(report.passed,'Smoke clip quality gate failed');
}finally{await writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(out);}
