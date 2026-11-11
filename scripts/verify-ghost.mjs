import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';
import { revealTypeForCard } from '../src/data/revealType.ts';

const out = process.env.GHOST_QA_DIR || path.join(os.tmpdir(), 'ghost-reveal-qa');
const base = process.env.GHOST_QA_URL || 'http://127.0.0.1:5177';
await mkdir(out, { recursive: true });
const report = { passed: false, errors: [], profiles: [] };
const browser = await launch();
const card = { id: 'base1-50', name: 'Gastly', image: 'https://assets.tcgdex.net/en/base/base1/50', types: ['Psychic'], dexId: [92] };
const artwork = await readFile('public/textures/gastly-preview.webp');
/** Compare final rendered frames, including the post-fog additive ribbon pass. */
const frameDifference = (page, on, off) => page.evaluate(async ({on,off}) => {
    const decode = async base64 => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'}));
        const canvas = new OffscreenCanvas(bitmap.width,bitmap.height), context=canvas.getContext('2d');
        context.drawImage(bitmap,0,0);
        const image=context.getImageData(0,0,canvas.width,canvas.height); bitmap.close();
        return image;
    };
    const a=await decode(on), b=await decode(off);
    let changed=0,brighter=0,cardInteriorChanged=0;
    for(let i=0;i<a.data.length;i+=4) {
        const difference=Math.max(...[0,1,2].map(c=>Math.abs(a.data[i+c]-b.data[i+c])));
        if(difference<=24)continue;
        changed++;
        if(a.data[i]+a.data[i+1]+a.data[i+2]>b.data[i]+b.data[i+1]+b.data[i+2])brighter++;
        const x=(i/4)%a.width,y=Math.floor(i/4/a.width);
        if(Math.abs(x-a.width*0.5)<a.width*0.035&&Math.abs(y-a.height*0.5)<a.height*0.025)cardInteriorChanged++;
    }
    return {width:a.width,height:a.height,changed,brighter,cardInteriorChanged};
},{on:on.toString('base64'),off:off.toString('base64')});
// Read the actual composited volume: these checks exercise GLSL, not source text.
const fog = page => page.evaluate(async () => {
    const { pixels, width, height } = window.__pokemonReveal.debug.mistPixels();
    const digest = await crypto.subtle.digest('SHA-256', pixels);
    let visible = 0, violet = 0, red = 0, dark = 0, highlights = 0, transparent = 0, energy = 0, luminance = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        const [r,g,b,a] = pixels.subarray(i,i+4);
        if (a > 16) {
            visible++;
            // The volume target is premultiplied linear RGB. Unpremultiply before
            // assessing the palette, so transparent edges do not count as dark matter.
            const light = (r * 0.2126 + g * 0.7152 + b * 0.0722) / a;
            luminance += light;
            if (light < 0.22) dark++;
            if (light > 0.35) highlights++;
            if (b > g * 1.4 && r > g * 1.2) violet++;
            if (r > g * 1.4 && r > b * 1.5) red++;
        }
        if (a < 4) transparent++;
        energy += r + g + b;
    }
    return { hash: Array.from(new Uint8Array(digest)).join(','), width, height,
        visible, violet, red, dark, highlights, transparent, energy, meanLuminance: luminance / Math.max(1,visible) };
});
try {
    for (const [name,dex,type] of [['Gastly',92,'ghost'],['Haunter',93,'ghost'],['Gengar',94,'ghost'],
        ['Misdreavus',200,'ghost'],['Duskull',355,'ghost'],['Machop',66,'fighting'],['Koffing',109,'poison']]) {
        for (const dexId of [[dex],[]]) assert.equal(revealTypeForCard({ ...card, name, dexId }), type, name);
    }
    for (const [profile,width,height] of [['desktop',1200,900],['mobile',390,844]]) {
        const context = await browser.newContext({ viewport: { width,height }, isMobile: profile === 'mobile', hasTouch: profile === 'mobile' });
        const page = await context.newPage();
        await isolate(page);
        page.on('pageerror', error => report.errors.push(String(error)));
        page.on('console', message => { if (message.type() === 'error' && !message.text().includes('CONTEXT_LOST')) report.errors.push(message.text()); });
        await page.route('https://api.tcgdex.net/**', route => route.fulfill({ json: route.request().url().includes('?') ? [card] : card }));
        await page.route('https://assets.tcgdex.net/**', route => route.fulfill({ contentType: 'image/webp', body: artwork }));
        await page.goto(`${base}/?reveal=ghost`);
        await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 60000 });
        await page.evaluate(() => window.__pokemonReveal.debug.setBlackBackground(false));
        await seek(page,1.2);
        const initial = await state(page);
        assert.equal(initial.effect,'GhostEffect');
        assert.equal(initial.mist.variant,'ghost');
        assert.equal(initial.mist.source,'replay');
        assert.equal(initial.mist.simulation,undefined,'Reuse Fighting clip without allocating a live solver');
        const peak = await fog(page);
        assert.ok(peak.visible > 600 && peak.violet > peak.visible * 0.6,'Dark violet volume remains clearly visible');
        assert.ok(peak.dark > peak.visible * 0.60,'Dark matter dominates the aura');
        assert.ok(peak.highlights > peak.visible * 0.003 && peak.highlights < peak.visible * 0.20,
            'Lilac highlights remain local instead of washing out the whole volume');
        assert.ok(peak.transparent > peak.width * peak.height * 0.75,'Ball remains visible through sparse volume');
        const ribbonInfo=await page.evaluate(()=>{
            const mesh=window.__pokemonReveal.debug.model.getObjectByName('GhostLightRibbons');
            return {count:new Set(mesh.geometry.attributes.aRibbon.array).size,
                depth:mesh.material.uniforms.uSceneDepth.value.isDepthTexture,
                additive:mesh.material.blending, hiddenInMainPass:!mesh.visible};
        });
        assert.equal(ribbonInfo.count,profile==='mobile'?3:4);
        assert.ok(ribbonInfo.depth&&ribbonInfo.hiddenInMainPass,'Ribbons have captured depth and render only after fog');
        assert.equal(ribbonInfo.additive,2,'Use the same additive blend as Psychic');
        const ribbonsOn=await page.screenshot({path:path.join(out,`${profile}-ribbons-on.png`),scale:'css'});
        await page.evaluate(()=>{window.__pokemonReveal.debug.model.getObjectByName('GhostLightRibbons').material.visible=false;});
        await seek(page,1.2);
        const ribbonsOff=await page.screenshot({path:path.join(out,`${profile}-ribbons-off.png`),scale:'css'});
        assert.equal((await fog(page)).hash,peak.hash,'Toggling real ribbons does not alter the smoke volume');
        const ribbonDifference=await frameDifference(page,ribbonsOn,ribbonsOff);
        assert.ok(ribbonDifference.brighter>width*height*0.001,'Light ribbons make a clearly visible contribution on the starry background');
        await page.evaluate(()=>{window.__pokemonReveal.debug.model.getObjectByName('GhostLightRibbons').material.visible=true;});
        await seek(page,2.65);
        const cardOn=await page.screenshot({scale:'css'});
        await page.evaluate(()=>{window.__pokemonReveal.debug.model.getObjectByName('GhostLightRibbons').material.visible=false;});
        await seek(page,2.65);
        const cardOff=await page.screenshot({scale:'css'});
        const cardDifference=await frameDifference(page,cardOn,cardOff);
        assert.equal(cardDifference.cardInteriorChanged,0,'Captured card depth prevents light painting over the illustration');
        await page.evaluate(()=>{window.__pokemonReveal.debug.model.getObjectByName('GhostLightRibbons').material.visible=true;});
        await seek(page,1.28);
        assert.notEqual((await fog(page)).hash,peak.hash,'Internal smoke structure moves');
        let previous = peak;
        for (const time of [1.22,1.24,1.26]) {
            await seek(page,time);
            const current = await fog(page);
            assert.ok(Math.abs(current.meanLuminance-previous.meanLuminance)<0.06,'Moving light does not strobe');
            previous = current;
        }
        await seek(page,2.65); await seek(page,1.2);
        assert.equal((await fog(page)).hash,peak.hash,'Reverse seek restores the same volume and eye pose');
        await page.evaluate(()=>window.__pokemonReveal.debug.setBlackBackground(true));
        await page.screenshot({path:path.join(out,`${profile}-aura-black-reference.png`),scale:'css'});
        await page.evaluate(()=>window.__pokemonReveal.debug.setBlackBackground(false));
        for (const [label,time] of [['01-whisper',0.56],['02-awakening',0.82],['03-aura',1.2],
            ['04-materialization',2.04],['05-card',2.65],['06-final',3.5]]) {
            await seek(page,time);
            await page.screenshot({ path: path.join(out,`${profile}-${label}.png`), scale: 'css' });
        }
        const final = await state(page), residual = await fog(page);
        assert.equal(final.cardScale,1.18);
        assert.equal(await page.evaluate(()=>window.__pokemonReveal.debug.model.getObjectByName('GhostLightRibbons').material.uniforms.uOpacity.value),0,'Light ribbons finish fading by the final frame');
        assert.ok(residual.energy < peak.energy * 0.20,'Final residue stays faint');
        const memory = final.memory;
        for (let i=0;i<3;i++) { await page.evaluate(() => window.__pokemonReveal.play('ghost')); await seek(page,3.5); }
        assert.deepEqual((await state(page)).memory,memory,'Replaying does not grow GPU resources');
        await page.evaluate(() => window.__pokemonReveal.play('ghost')); await seek(page,1.1);
        await page.evaluate(() => window.__pokemonReveal.stop());
        assert.equal((await state(page)).running,false);
        await page.evaluate(() => window.__pokemonReveal.play('fighting')); await seek(page,1.1);
        const fighting = await state(page);
        assert.equal(fighting.effect,'FightingEffect');
        assert.equal(fighting.mist.source,'replay','Existing Fighting replay remains valid');
        const fightingFog = await fog(page);
        assert.ok(fightingFog.red > fightingFog.visible * 0.60,'Fighting retains its original red smoke');
        await page.screenshot({ path: path.join(out,`${profile}-fighting-regression.png`), scale: 'css' });
        await page.evaluate(() => window.__pokemonReveal.play('psychic')); await seek(page,1.2);
        assert.equal((await state(page)).effect,'PsychicEffect');
        await page.screenshot({ path: path.join(out,`${profile}-psychic-regression.png`), scale: 'css' });
        await page.locator('#pokemon-name').fill('Gastly');
        await page.locator('#pokemon-search button').click();
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().effect === 'GhostEffect' && document.querySelector('#summon-status').textContent === '');
        await seek(page,1.2);
        await page.setViewportSize({width:width-30,height:height-30});
        await page.waitForFunction(() => {
            const canvas = document.querySelector('canvas').getBoundingClientRect();
            return Math.abs(canvas.width-innerWidth)<1 && Math.abs(canvas.height-innerHeight)<1;
        });
        await seek(page,1.25);
        const fit = await page.evaluate(() => ({ w:innerWidth,h:innerHeight,
            sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,
            controls:document.querySelector('#pokemon-search').getBoundingClientRect().toJSON() }));
        assert.ok(fit.sw<=fit.w && fit.sh<=fit.h && fit.controls.top>=0 && fit.controls.bottom<=fit.h
            && fit.controls.left>=0 && fit.controls.right<=fit.w,`Scene and controls fit the viewport: ${JSON.stringify(fit)}`);
        if (profile === 'desktop') {
            await page.setViewportSize({width,height});
            await seek(page,0);
            await page.evaluate(() => {
                window.ghostChunks=[];
                window.ghostStream=document.querySelector('canvas').captureStream(30);
                window.ghostRecorder=new MediaRecorder(window.ghostStream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:5000000});
                window.ghostRecorder.ondataavailable=e=>{if(e.data.size)window.ghostChunks.push(e.data)};
                window.ghostRecorder.start(); window.__pokemonReveal.debug.resume(0.5);
            });
            await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time === 3.5,null,{timeout:20000});
            const video = await page.evaluate(async () => {
                await new Promise(resolve=>{window.ghostRecorder.onstop=resolve;window.ghostRecorder.stop()});
                window.ghostStream.getTracks().forEach(track=>track.stop());
                return Array.from(new Uint8Array(await new Blob(window.ghostChunks,{type:'video/webm'}).arrayBuffer()));
            });
            await writeFile(path.join(out,'desktop-motion.webm'),Buffer.from(video));
        }
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.evaluate(() => window.__pokemonReveal.play('ghost'));
        assert.equal((await state(page)).time,3.5);
        await page.evaluate(() => window.__pokemonReveal.dispose());
        const disposed = await state(page);
        assert.ok(disposed.disposed); assert.equal(disposed.memory.geometries,0);
        report.profiles.push({ profile, peak, residual, fit, ribbonInfo, ribbonDifference, cardDifference });
        await context.close();
    }
    assert.deepEqual(report.errors,[]);
    report.passed = true;
} finally {
    await browser.close();
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
}
console.log(`Ghost routing, rendered flow, deterministic seek, Fighting reuse, six desktop/mobile phases, search, replay, interruption, resize, reduced motion and disposal passed. ${out}`);
