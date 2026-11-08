// Regenerate both production containers from the accepted full-quality solver.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { launch, isolate } from './ice-test-fixture.mjs';
import { createSmokeClip, sha } from './smoke-clip-codec.mjs';
import { REPLAY_CONTRACT } from '../src/effects/smokeReplayTypes.ts';
import { SMOKE_DT, SMOKE_DURATION, SMOKE_FRAMES } from '../src/effects/smokeTiming.ts';
import { smokeProfile } from '../src/effects/smokeProfile.ts';
import { parseSmokeClip } from '../src/effects/smokeClipFormat.ts';
import { SMOKE_OPENING } from '../src/effects/smokeBoundary.ts';

const bits=Number(process.argv.find(a=>a.startsWith('--bits='))?.split('=')[1]||8);
const variant=process.argv.find(a=>a.startsWith('--variant='))?.split('=')[1]||'ice';
assert.ok(['ice','fighting'].includes(variant),'--variant must be ice or fighting');
const config=smokeProfile(variant),smokeSourceFrame=config.sourceFrame;
const comparison=process.argv.find(a=>a.startsWith('--compare-ice='))?.slice('--compare-ice='.length);
if(comparison)assert.equal(variant,'ice','Ice comparison requires --variant=ice');
assert.ok([8,12,16].includes(bits),'--bits must be 8, 12 or 16');
const keepReference=process.argv.includes('--reference');
const temporary=path.join(os.tmpdir(),`poke-smoke-export-${Date.now()}`);await mkdir(temporary,{recursive:true});
const sources={};
for(const name of ['gpuSmokeSimulation.ts','gpuSmokeShaders.ts','smokeBoundary.ts','smokeProfile.ts'])sources[name]=sha((await readFile(`src/effects/${name}`,'utf8')).replace(/\r\n?/g,'\n'));
const metadata={contract:REPLAY_CONTRACT,id:'',dt:SMOKE_DT,duration:SMOKE_DURATION,frames:SMOKE_FRAMES,chunkFrames:4,
    variant,timingId:config.timingId,sourceFrameIndices:Array.from({length:SMOKE_FRAMES},(_,i)=>smokeSourceFrame(i)),
    domainMin:config.domainMin,domainSize:config.domainSize,preset:config.preset,opening:SMOKE_OPENING,
    modelSHA256:sha(await readFile('src/assets/pokeball.glb')),sources};
const destination=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice('--output='.length)||'src/assets/mist-replay'),token=randomUUID(),results=[];
let layout,expected=0,pending=[],builder,reference;
const server=createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:5173');
    try{
        const url=new URL(req.url,'http://localhost');assert.equal(url.searchParams.get('token'),token);assert.equal(req.method,'POST');
        const frame=Number(url.searchParams.get('frame'));assert.equal(frame,expected);
        const pieces=[];for await(const piece of req)pieces.push(piece);
        const bytes=Buffer.concat(pieces);assert.equal(bytes.length,layout.width*layout.height*2);
        pending.push(bytes);expected++;
        if(pending.length===4||frame===SMOKE_FRAMES-1){builder.add(pending);reference?.add(pending);pending=[];}
        res.end('ok');
    }catch(error){res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const browser=await launch();
try{
    for(const [name,width,n,velocity]of[['desktop',1280,128,64],['mobile',600,96,48]]){
        expected=0;pending=[];const tiles=Math.ceil(Math.sqrt(n));
        layout={resolution:n,tiles,width:n*tiles,height:n*Math.ceil(n/tiles),velocityResolution:velocity,channels:1,lightSteps:name==='mobile'?6:8};
        builder=createSmokeClip(metadata,name,layout,bits);reference=keepReference?createSmokeClip(metadata,name,layout,16):undefined;
        const context=await browser.newContext({viewport:{width,height:800},deviceScaleFactor:1}),page=await context.newPage();await isolate(page);
        await page.goto(`http://127.0.0.1:5173/?reveal=${variant}&smokeSource=live`);
        await page.waitForFunction(()=>window.__pokemonReveal?.debug,null,{timeout:120000});await page.evaluate(()=>window.__pokemonReveal.stop());
        for(let frame=0;frame<SMOKE_FRAMES;frame++){
            await page.evaluate(async({frame,sourceFrame,port,token})=>{
                const data=window.__pokemonReveal.debug.exportMistFrame(sourceFrame);
                const response=await fetch(`http://127.0.0.1:${port}/?frame=${frame}&token=${token}`,{method:'POST',body:data.buffer});
                if(!response.ok)throw new Error(await response.text());
            },{frame,sourceFrame:smokeSourceFrame(frame),port,token});
            if(frame%30===0)console.log(`${name}: ${frame}/${SMOKE_FRAMES-1}`);
        }
        assert.equal(expected,SMOKE_FRAMES);
        const clip=builder.finish();
        if(comparison){
            const original=await readFile(path.join(comparison,`ice-${name}.bin`));
            const previous=parseSmokeClip(original.buffer.slice(original.byteOffset,original.byteOffset+original.byteLength)).header;
            const hashes=h=>h.profile.chunks.flatMap(c=>c.frames.map(f=>[f.sourceSHA256,f.densitySHA256]));
            assert.deepEqual(hashes(clip.header),hashes(previous),`${name}: every original and quantized Ice field must remain identical`);
            console.log(`${name}: 211 original + 211 quantized Ice fields unchanged`);
        }
        await writeFile(path.join(temporary,`${variant}-${name}.bin`),clip.buffer);
        if(reference)await writeFile(path.join(temporary,`reference-${name}.bin`),reference.finish().buffer);
        results.push({name,bytes:clip.buffer.length,encodingBits:bits,id:clip.header.id});
        await page.evaluate(()=>window.__pokemonReveal.dispose());await context.close();
    }
    // Finish both profiles before replacing any runtime asset.
    await mkdir(destination,{recursive:true});
    for(const {name}of results)await writeFile(path.join(destination,`${variant}-${name}.bin`),await readFile(path.join(temporary,`${variant}-${name}.bin`)));
    await writeFile(path.join(temporary,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results));console.log(`Export/reference: ${temporary}`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
