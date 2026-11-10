import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { launch, isolate, seek, state } from './ice-test-fixture.mjs';
import { revealTypeForCard } from '../src/data/revealType.ts';

const base = process.env.STEEL_QA_URL || 'http://127.0.0.1:5177';
const out = process.env.STEEL_QA_DIR || path.join(os.tmpdir(), 'steel-reveal-qa');
await mkdir(out, { recursive: true });
const report = { passed: false, errors: [], profiles: [], scenarios: [] };
const browser = await launch();

async function open(width, height, reduced = false, textureMode = 'normal') {
    const context = await browser.newContext({ viewport: { width, height },
        isMobile: width < 700, hasTouch: width < 700, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await context.newPage(); await isolate(page);
    if (textureMode === 'missing') await page.route('**/textures/steel-brushed-detail.webp', route => route.fulfill({
        status: 200, contentType: 'image/webp', body: 'unavailable texture',
    }));
    if (textureMode === 'slow') await page.route('**/textures/steel-brushed-detail.webp', async route => {
        await new Promise(resolve => setTimeout(resolve, 900));
        await route.fulfill({ contentType: 'image/webp', body: await readFile('public/textures/steel-brushed-detail.webp') });
    });
    page.on('pageerror', error => report.errors.push(String(error)));
    page.on('console', message => {
        if (message.type() === 'error' && !message.text().includes('CONTEXT_LOST')) report.errors.push(message.text());
    });
    const card = { id: 'me04-061', name: 'Metagross', types: ['Metal'], dexId: [376], image: '/textures/metagross-preview.webp' };
    await page.route('https://api.tcgdex.net/**', route => route.fulfill({ json: route.request().url().includes('?') ? [card] : card }));
    await page.goto(`${base}/?reveal=steel`);
    await page.waitForFunction(() => window.__pokemonReveal?.debug && document.querySelector('#summon-status').textContent === '', null, { timeout: 60000 });
    return page;
}

async function geometry(page) {
    return page.evaluate(() => {
        const model = window.__pokemonReveal.debug.model;
        const ribbon = model.getObjectByName('SteelOpenRibbons');
        const drops = ['SteelCurledChips', 'SteelTwistedShavings', 'SteelFlakes', 'SteelHeroShards'].map(name => model.getObjectByName(name));
        let live = 0;
        for (const mesh of drops) for (let i = 0; i < mesh.count; i++) {
            const m = mesh.instanceMatrix.array, j = i * 16;
            if (Math.hypot(m[j], m[j + 1], m[j + 2]) > 0.0001) live++;
        }
        const ribbonPositions = Array.from(ribbon.geometry.attributes.position.array);
        const x = ribbonPositions.filter((_,i)=>i%3===0);
        const hero = drops[3], heroMatrices = hero.instanceMatrix.array;
        const heroHeights = Array.from({length:hero.count},(_,i)=>heroMatrices[i*16+13]);
        return { positions: ribbonPositions,
            normals: Array.from(ribbon.geometry.attributes.normal.array), live,
            matrices: drops.map(mesh => Array.from(mesh.instanceMatrix.array)),
            visible: ribbon.visible, roots: model.children.filter(o => o.name === 'SteelEffect').length,
            composition: { width:Math.max(...x)-Math.min(...x), heroCount:hero.count,
                heroHeightRange:Math.max(...heroHeights)-Math.min(...heroHeights),
                energyVisible:model.getObjectByName('SteelFilament').visible,
                energyOpacity:model.getObjectByName('SteelFilament').material.uniforms.uOpacity.value },
            metal: { transparent: ribbon.material.transparent, metalness: ribbon.material.metalness,
                environment: Boolean(ribbon.material.envMap), shared: drops.every(mesh => mesh.material === ribbon.material) },
            surface: { texture: ribbon.material.roughnessMap.name, width: ribbon.material.roughnessMap.image.width,
                bump: ribbon.material.bumpMap === ribbon.material.roughnessMap,
                jetUV: Boolean(model.getObjectByName('SteelBasinSplashes').geometry.attributes.uv),
                chips: drops.map(mesh => mesh.geometry.type) },
            lighting: { rim: model.getObjectByName('SteelRimLight').intensity,
                accent: model.getObjectByName('SteelAccentLight').intensity,
                visible: ['SteelHalo','SteelBasinRadiance','SteelOuterHaze'].map(name => model.getObjectByName(name).visible) } };
    });
}

async function pixels(page, on, off, cardOnly = false) {
    return page.evaluate(async ({ a, b, cardOnly }) => {
        const decode = async data => {
            const image = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
            const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0); image.close(); return ctx.getImageData(0, 0, canvas.width, canvas.height);
        };
        const first = await decode(a), second = await decode(b);
        let bounds;
        if (cardOnly) {
            const THREE = await import('/node_modules/.vite/deps/three.js');
            const card = window.__pokemonReveal.debug.card;
            // Project an inset rectangle using the same camera as the scene.
            const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);
            camera.position.set(0, 0.32, camera.aspect < 0.8 ? 4.2 : 3.15); camera.lookAt(0, 0.32, 0); camera.updateMatrixWorld();
            const points = [[-0.22,-0.34],[0.22,0.34]].map(([x,y]) => card.localToWorld(new THREE.Vector3(x,y,0.04)).project(camera));
            bounds = { x0: Math.ceil((Math.min(...points.map(p=>p.x))+1)*first.width/2),
                x1: Math.floor((Math.max(...points.map(p=>p.x))+1)*first.width/2),
                y0: Math.ceil((1-Math.max(...points.map(p=>p.y)))*first.height/2),
                y1: Math.floor((1-Math.min(...points.map(p=>p.y)))*first.height/2) };
        }
        let changed = 0, bright = 0, dark = 0;
        for (let y = bounds?.y0 ?? 0; y < (bounds?.y1 ?? first.height); y++)
            for (let x = bounds?.x0 ?? 0; x < (bounds?.x1 ?? first.width); x++) {
                const i = (y * first.width + x) * 4;
                const delta = Math.max(...[0,1,2].map(c => Math.abs(first.data[i+c] - second.data[i+c])));
                if (delta < 6) continue;
                changed++;
                const rgb = first.data.subarray(i, i+3), maximum = Math.max(...rgb), minimum = Math.min(...rgb);
                if (maximum > 175 && maximum - minimum < 65) bright++;
                if (maximum > 20 && maximum < 145 && maximum - minimum < 55) dark++;
            }
        return { changed, bright, dark, bounds };
    }, { a: on.toString('base64'), b: off.toString('base64'), cardOnly });
}

async function withoutMetal(page) {
    await page.evaluate(() => {
        window.__pokemonReveal.debug.model.getObjectByName('SteelOpenRibbons').material.colorWrite = false;
        window.__pokemonReveal.debug.setBlackBackground(true);
    });
    const image = await page.screenshot();
    await page.evaluate(() => {
        window.__pokemonReveal.debug.model.getObjectByName('SteelOpenRibbons').material.colorWrite = true;
        window.__pokemonReveal.debug.setBlackBackground(true);
    });
    return image;
}

async function withoutAtmosphere(page) {
    await page.evaluate(() => {
        for (const name of ['SteelHalo','SteelBasinRadiance','SteelOuterHaze'])
            window.__pokemonReveal.debug.model.getObjectByName(name).material.colorWrite = false;
        window.__pokemonReveal.debug.setBlackBackground(true);
    });
    const image = await page.screenshot();
    await page.evaluate(() => {
        for (const name of ['SteelHalo','SteelBasinRadiance','SteelOuterHaze'])
            window.__pokemonReveal.debug.model.getObjectByName(name).material.colorWrite = true;
        window.__pokemonReveal.debug.setBlackBackground(true);
    });
    return image;
}

async function withoutEnergy(page) {
    await page.evaluate(() => {
        for (const name of ['SteelFilament','SteelSourceBranches'])
            window.__pokemonReveal.debug.model.getObjectByName(name).material.colorWrite = false;
        window.__pokemonReveal.debug.setBlackBackground(true);
    });
    const image = await page.screenshot();
    await page.evaluate(() => {
        for (const name of ['SteelFilament','SteelSourceBranches'])
            window.__pokemonReveal.debug.model.getObjectByName(name).material.colorWrite = true;
        window.__pokemonReveal.debug.setBlackBackground(true);
    });
    return image;
}

try {
    for (const [name, dexId, expected] of [['Metagross',376,'steel'],['Steelix',208,'steel'],['Scizor',212,'bug'],['Empoleon',395,'water']])
        assert.equal(revealTypeForCard({name,dexId:[dexId],types:['Metal'],image:''}), expected);
    assert.equal(revealTypeForCard({name:'Unknown steel card',dexId:[],types:['Metal'],image:''}), 'steel');
    for (const [profile, width, height] of [['desktop',1280,900],['mobile',390,844]]) {
        const page = await open(width, height);
        await seek(page, 0.35); const early = await geometry(page);
        await seek(page, 1.18); const peak = await geometry(page);
        assert.ok(peak.live > early.live * 2, 'The orbit peak has the richest fan');
        assert.deepEqual(peak.metal, { transparent:false, metalness:1, environment:true, shared:true });
        assert.equal(peak.surface.texture, 'SteelBrushedDetail', 'Texture ready before playback');
        assert.equal(peak.surface.width, 1024); assert.equal(peak.surface.bump, true);
        assert.equal(peak.surface.jetUV, true);
        assert.ok(peak.surface.chips.every(type => type !== 'SphereGeometry'), 'Ejected metal uses cut sheets, never drops');
        assert.ok(peak.composition.width > (profile==='desktop'?1.95:1.65), 'The open orbit spans the Ball opening');
        assert.ok(peak.composition.heroCount >= 6 && peak.composition.heroHeightRange > 0.35, 'Large fragments occupy different heights');
        assert.ok(peak.composition.energyVisible && peak.composition.energyOpacity > 1, 'Prominent source core at orbit peak');
        assert.ok(peak.lighting.rim > early.lighting.rim && peak.lighting.accent > 0);
        assert.ok(peak.positions.every(Number.isFinite) && peak.normals.every(Number.isFinite));
        await page.evaluate(() => window.__pokemonReveal.debug.setBlackBackground(true));
        const on = await page.screenshot(); const off = await withoutMetal(page);
        const reflections = await pixels(page, on, off);
        assert.ok(reflections.bright > 30 && reflections.dark > 30, `Bright and graphite metal on black: ${JSON.stringify(reflections)}`);
        const atmosphere = await pixels(page, on, await withoutAtmosphere(page));
        assert.ok(atmosphere.changed > 80, 'The silver atmosphere visibly fills space');
        const energyContribution = await pixels(page, on, await withoutEnergy(page));
        assert.ok(energyContribution.changed > 200, 'The core and source branches are clearly visible');
        await seek(page, 1.28); const moving = await geometry(page);
        assert.notDeepEqual(moving.positions, peak.positions, 'Strips deform locally');
        assert.notDeepEqual(moving.normals, peak.normals, 'Surface orientation changes reflections');
        await seek(page, 1.18); assert.deepEqual(await geometry(page), peak, 'Seek/replay is deterministic');
        for (const time of [0.35,0.78,1.18,1.90,2.60,3.5]) {
            await seek(page, time); await page.evaluate(() => window.__pokemonReveal.debug.setBlackBackground(true));
            await page.screenshot({path:path.join(out,`${profile}-${time.toFixed(2)}.png`)});
            await page.evaluate(() => window.__pokemonReveal.debug.setBlackBackground(false));
            await page.screenshot({path:path.join(out,`${profile}-${time.toFixed(2)}-sky.png`)});
            await page.evaluate(() => window.__pokemonReveal.debug.setBlackBackground(true));
            if (time === 1.9 || time === 2.6) {
                const on = await page.screenshot(), off = await withoutMetal(page);
                const clearance = await pixels(page, on, off, true);
                assert.equal(clearance.changed, 0, `No metal over the silhouette/illustration: ${JSON.stringify(clearance)}`);
                const atmosphereClearance = await pixels(page, on, await withoutAtmosphere(page), true);
                assert.equal(atmosphereClearance.changed, 0, 'Atmosphere also clears the rotating card');
                const energyClearance = await pixels(page, on, await withoutEnergy(page), true);
                assert.equal(energyClearance.changed, 0, 'Core and branches clear the rotating card');
            }
        }
        const end = await geometry(page), endState = await state(page);
        assert.equal(end.visible, false); assert.equal(endState.running, false); assert.equal(endState.cardScale, 0.94);
        assert.ok(end.live <= 9 && end.live > 0, 'Only a few basin flakes remain');
        assert.deepEqual(end.lighting, {rim:0,accent:0,visible:[false,false,false]}, 'Lighting fades out completely');
        await seek(page, 2.85);
        assert.deepEqual((await geometry(page)).lighting, end.lighting, 'All light shafts vanish by image handoff end');
        await page.evaluate(async () => { await window.__pokemonReveal.play('steel'); await window.__pokemonReveal.debug.seek(1.18); });
        const memory = (await state(page)).memory;
        for (let i = 0; i < 3; i++) {
            await page.evaluate(async () => { await window.__pokemonReveal.play('steel'); await window.__pokemonReveal.debug.seek(1.18); });
            assert.equal((await geometry(page)).roots, 1);
            assert.deepEqual((await state(page)).memory, memory, 'Replays reuse GPU resources');
        }
        await page.evaluate(async () => {
            await window.__pokemonReveal.play('psychic');
            await window.__pokemonReveal.debug.seek(0.8);
        });
        assert.equal((await geometry(page)).lighting.rim, 0, 'Steel lights switch off for other types');
        await page.evaluate(async () => {
            await window.__pokemonReveal.play('steel');
            await window.__pokemonReveal.debug.seek(1.18);
        });
        assert.deepEqual(await geometry(page), peak, 'Type interruption restores Steel deterministically');
        await page.locator('#pokemon-name').fill('Metagross');
        await page.locator('#pokemon-search button').click();
        await page.waitForFunction(() => document.querySelector('#summon-status').textContent === '' && window.__pokemonReveal.debug.snapshot().effect === 'SteelEffect');
        await seek(page, 0.7); await page.evaluate(() => window.__pokemonReveal.debug.resume(0.5));
        await page.waitForFunction(() => window.__pokemonReveal.debug.snapshot().time > 1.35);
        await seek(page, 3.5);
        await page.setViewportSize({width:width-30,height:height-60});
        assert.equal((await state(page)).effect, 'SteelEffect');
        report.profiles.push({profile, reflections, atmosphere, energyContribution,
            composition:peak.composition, peakChips:peak.live, finalFlakes:end.live, memory});
        await page.evaluate(() => { window.__pokemonReveal.dispose(); window.__pokemonReveal.dispose(); });
        assert.equal((await state(page)).disposed, true);
        await page.context().close();
    }
    const reduced = await open(390,844,true);
    const reducedState = await state(reduced);
    assert.equal(reducedState.running,false); assert.equal(reducedState.time,reducedState.duration);
    report.scenarios.push('Six stages on desktop/mobile; black background reflections; silhouette/image clearance; replay; type interruption; form search; live motion; resize; reduced motion; double dispose');
    await reduced.context().close();
    for (const mode of ['missing','slow']) {
        const page = await open(390,844,false,mode);
        await seek(page,1.18);
        const info = await geometry(page);
        assert.equal(info.surface.bump,mode==='slow');
        assert.equal(info.surface.texture,mode==='slow'?'SteelBrushedDetail':'');
        assert.equal((await state(page)).effect,'SteelEffect');
        await page.context().close();
        report.scenarios.push(`Texture ${mode}: playback ready with ${mode==='slow'?'loaded image':'procedural fallback'}`);
    }
    const late = await open(390,844);
    await late.route('**/textures/steel-brushed-detail.webp',async route => {
        await new Promise(resolve=>setTimeout(resolve,350));
        await route.fulfill({contentType:'image/webp',body:await readFile('public/textures/steel-brushed-detail.webp')});
    });
    assert.equal(await late.evaluate(async()=>{
        const {SteelEffect}=await import('/src/effects/steel.ts');
        const THREE=await import('/node_modules/.vite/deps/three.js');
        const card=new THREE.Mesh();
        const probe=new SteelEffect(card,true);
        const material=probe.root.getObjectByName('SteelOpenRibbons').material;
        probe.dispose(); await probe.ready;
        card.geometry.dispose(); card.material.dispose();
        return material.bumpMap===null && probe.root.parent===null;
    }),true,'Late texture cannot mutate a disposed effect');
    await late.context().close();
    report.scenarios.push('Texture arrival after disposal is discarded; bright/dark metal and atmosphere card masks; lights fade and deactivate; six stages on both backgrounds');
    assert.deepEqual(report.errors,[]);
    report.passed = true;
} finally {
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
    await browser.close();
}
console.log(JSON.stringify({passed:report.passed,out,profiles:report.profiles},null,2));
