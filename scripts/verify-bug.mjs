import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';

const base=process.env.BUG_BASE_URL || 'http://127.0.0.1:5173';
const out=process.env.BUG_QA_DIR || path.join(os.tmpdir(),'bug-qa');
const baselineDir=process.env.BUG_BASELINE_DIR;
await mkdir(out,{recursive:true});
const report={profiles:[],scenarios:[],motion:[],regression:[],errors:[],passed:false};
const browser=await launch();
const artwork=await readFile('public/textures/caterpie-preview.webp');
const cards={Caterpie:{id:'base1-45',name:'Caterpie',image:'https://assets.tcgdex.net/en/base/base1/45',types:['Grass'],dexId:[10]},Butterfree:{id:'base1-33',name:'Butterfree',image:'https://assets.tcgdex.net/en/base/base1/33',types:['Grass'],dexId:[12]}};

async function setup(width,height) {
    const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
    const page=await context.newPage(); await isolate(page);
    await page.route('https://api.tcgdex.net/**',route=>{
        const url=new URL(route.request().url()); const card=cards[url.searchParams.get('name')] || cards.Caterpie;
        return route.fulfill({json:url.searchParams.has('name')?[card]:card});
    });
    await page.route('https://assets.tcgdex.net/**',route=>route.fulfill({body:artwork,contentType:'image/webp'}));
    page.on('pageerror',error=>report.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error'&&/THREE|GLSL|WebGL|shader/i.test(message.text()))report.errors.push(message.text());});
    await page.goto(`${base}/?reveal=bug`);
    await page.waitForFunction(()=>window.__pokemonReveal?.debug&&document.querySelector('#summon-status').textContent==='',null,{timeout:60000});
    await page.evaluate(()=>window.__pokemonReveal.stop());
    return page;
}

async function record(page,profile,rate) {
    await seek(page,0);
    await page.evaluate(()=>{
        window.bugChunks=[];
        window.bugStream=document.querySelector('canvas').captureStream(60);
        window.bugRecorder=new MediaRecorder(window.bugStream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:7000000});
        window.bugRecorder.ondataavailable=e=>{if(e.data.size)window.bugChunks.push(e.data);};
        window.bugRecorder.start();
    });
    const before=await state(page), started=Date.now();
    await page.evaluate(rate=>window.__pokemonReveal.debug.resume(rate),rate);
    await page.waitForFunction(()=>window.__pokemonReveal.debug.snapshot().time===3.5,null,{timeout:30000});
    const elapsed=Date.now()-started, after=await state(page);
    const data=await page.evaluate(async()=>{
        await new Promise(resolve=>{window.bugRecorder.onstop=resolve;window.bugRecorder.stop();});
        window.bugStream.getTracks().forEach(track=>track.stop());
        const blob=new Blob(window.bugChunks,{type:'video/webm'});
        return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);});
    });
    const file=`${profile}-${rate}x.webm`;
    await writeFile(path.join(out,file),Buffer.from(data.split(',')[1],'base64'));
    assert.ok(elapsed>=3500/rate-180&&elapsed<3500/rate+2500,`Playback duration ${elapsed}`);
    report.motion.push({file,elapsed,frames:after.renderedFrames-before.renderedFrames});
}

try {
    for(const [profile,width,height,flies,bands,wings] of [['desktop',1280,900,36,4,3],['mobile',390,844,24,3,2]]) {
        const page=await setup(width,height);
        const initial=await state(page);
        assert.equal(initial.effect,'BugEffect'); assert.equal(initial.duration,3.5);
        assert.equal(initial.bug.flies,flies); assert.equal(initial.bug.bands,bands); assert.equal(initial.bug.wings,wings);
        assert.equal(await page.evaluate(()=>Boolean(window.__pokemonReveal.debug.model.getObjectByName('BugChitin'))),false);
        const fit=await page.evaluate(()=>{const b=document.querySelector('#pokemon-search').getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth>innerWidth};});
        assert.ok(fit.left>=0&&fit.right<=fit.width&&fit.top>=0&&fit.bottom<=fit.height&&!fit.scroll,'Controls fit viewport');
        for(const side of [false,true]) {
            await page.evaluate(side=>window.__pokemonReveal.debug.sideView(side),side);
            for(const time of [0.25,0.65,1.25,1.85,2.45,3.15,3.5]) {
                await seek(page,time);
                await page.screenshot({path:path.join(out,`${profile}-${side?'side':'front'}-${time}.png`)});
                if(time===3.5)assert.equal((await state(page)).cardScale,1.18);
            }
        }
        await page.evaluate(()=>window.__pokemonReveal.debug.sideView(false));
        await seek(page,1.25);
        const a=await page.evaluate(()=>{
            const d=window.__pokemonReveal.debug,flies=d.model.getObjectByName('BugFireflies');
            return {positions:Array.from(flies.geometry.attributes.position.array),lights:d.snapshot().bug.lights};
        });
        await seek(page,1.35);
        const b=await page.evaluate(()=>{
            const d=window.__pokemonReveal.debug,flies=d.model.getObjectByName('BugFireflies');
            return {positions:Array.from(flies.geometry.attributes.position.array),lights:d.snapshot().bug.lights};
        });
        assert.notDeepEqual(a.positions,b.positions); assert.notDeepEqual(a.lights,b.lights);
        assert.ok(a.lights.some(light=>light<0.02)&&a.lights.some(light=>light>0.7),'Independent on/off pulses');
        await seek(page,1.25);
        assert.deepEqual(await page.evaluate(()=>Array.from(window.__pokemonReveal.debug.model.getObjectByName('BugFireflies').geometry.attributes.position.array)),a.positions);
        await seek(page,3.15);
        assert.ok((await state(page)).bug.lights.slice(3).every(light=>light===0),'Only final three may remain');
        for(const rate of [1,0.25]) await record(page,profile,rate);

        // User input exercises the actual search -> image -> resolver -> playback path.
        await page.locator('#pokemon-name').fill('Butterfree');
        await page.locator('#pokemon-search button').click();
        await page.waitForFunction(()=>document.querySelector('#summon-status').textContent===''&&window.__pokemonReveal.debug.snapshot().time===3.5);
        assert.equal((await state(page)).effect,'BugEffect');
        await page.mouse.move(width/2,height*0.5); await page.mouse.down(); await page.mouse.move(width/2+60,height*0.55,{steps:10}); await page.mouse.up();
        await page.screenshot({path:path.join(out,`${profile}-interaction.png`)});

        for(const effect of ['psychic','grass','bug']) {await page.evaluate(effect=>window.__pokemonReveal.play(effect),effect);await seek(page,1.25);}
        const warm=(await state(page)).memory;
        for(let i=0;i<5;i++) {
            await page.evaluate(()=>window.__pokemonReveal.play('bug')); await seek(page,0.7);
            await page.evaluate(()=>window.__pokemonReveal.play('grass')); await seek(page,1.0);
            await page.evaluate(()=>window.__pokemonReveal.play('bug')); await seek(page,2.0);
            assert.deepEqual((await state(page)).memory,warm,'Stable GPU resource count after warmup');
        }
        await page.setViewportSize({width:width-20,height:height-40}); await seek(page,1.25);
        await page.setViewportSize({width,height});
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
        assert.equal((await state(page)).running,false);
        await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});

        if(profile==='desktop' && baselineDir) {
            await page.locator('#pokemon-name').fill('');
            await page.locator('#pokemon-name').blur();
            await page.evaluate(()=>window.__pokemonReveal.setCardImage('/textures/pidgeotto-preview.webp'));
            for(const effect of ['psychic','grass']) {
                await page.evaluate(effect=>window.__pokemonReveal.play(effect),effect);
                for(const time of [0.6,1.25,2.4,3.5]) {
                    await seek(page,time);
                    const actual=await page.screenshot();
                    await writeFile(path.join(out,`actual-${effect}-${time}.png`),actual);
                    const baseline=await readFile(path.join(baselineDir,`baseline-${effect}-${time}.png`));
                    const changed=await page.evaluate(async([a,b])=>{
                        const decode=async data=>{
                            const img=new Image();img.src=`data:image/png;base64,${data}`;await img.decode();
                            const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
                            const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
                            // Baseline startup may still show "Loading Abra" above the scene.
                            return ctx.getImageData(0,160,img.width,img.height-160).data;
                        };
                        const x=await decode(a),y=await decode(b);let different=0,total=0;
                        for(let i=0;i<x.length;i+=4){const d=Math.max(Math.abs(x[i]-y[i]),Math.abs(x[i+1]-y[i+1]),Math.abs(x[i+2]-y[i+2]));total+=d;if(d>2)different++;}
                        return {different,ratio:different/(x.length/4),mean:total/(x.length/4)};
                    },[actual.toString('base64'),baseline.toString('base64')]);
                    // Allow subpixel edge rasterization; substantive changes fail both area/mean gates.
                    assert.ok(changed.ratio<0.0005&&changed.mean<0.05,`${effect} ${time}: scene visual regression ${JSON.stringify(changed)}`);
                    report.regression.push({effect,time,...changed});
                }
            }
        }
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.evaluate(()=>window.__pokemonReveal.play('bug'));
        assert.equal((await state(page)).time,3.5); assert.equal((await state(page)).running,false);
        await page.evaluate(()=>window.__pokemonReveal.dispose());
        assert.equal((await state(page)).memory.geometries,0);
        report.profiles.push({profile,flies,bands,wings,memory:warm});
        await page.context().close();
    }
    report.scenarios.push('Six phases + final card, front/side, normal/slow playback, search, drag, rewind, replay, interruption, type switching, resize, visibility, reduced motion, teardown');
    assert.deepEqual(report.errors,[]);
    report.passed=true;
} finally {
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
    await browser.close();
}
console.log(`Bug visual/integration checks passed: ${out}`);
