import { GroundEffect } from '../effects/ground';
import { RockEffect } from '../effects/rock';
import { BugEffect } from '../effects/bug';
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import gsap from 'gsap';

import pokeballUrl from '../assets/pokeball.glb?url';
import skyEnvironmentUrl from '../assets/sky/NightSkyHDRI006_4K_HDR.exr?url';
import { PsychicEffect } from '../effects/psychic';
import { ElectricEffect } from '../effects/electric';
import { GrassEffect } from '../effects/grass';
import { FlyingEffect } from '../effects/flying';
import { FireEffect } from '../effects/fire';
import { WaterEffect } from '../effects/water';
import { IceEffect } from '../effects/ice';
import { FightingEffect } from '../effects/fighting';
import { PoisonEffect } from '../effects/poison';
import { GpuSmokeMist } from '../effects/gpuSmokeMist';
import { GpuTimer } from '../effects/gpuTimer';
import { SmokeBoundarySampler, SMOKE_OPENING } from '../effects/smokeBoundary';
import { CARD_REVEAL_TIMING } from '../effects/cardTransformation';
import { SMOKE_DURATION } from '../effects/smokeTiming';
import type { PokemonRevealEffect, RevealType } from '../effects/types';
import { createCardGeometry } from './card';

function loadCardTexture(url: string): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
        let timedOut = false;
        const timeout = window.setTimeout(() => {
            timedOut = true;
            reject(new Error(`Card image timed out: ${url}`));
        }, 5000);
        new THREE.TextureLoader().load(url, (texture) => {
            if (timedOut) {
                texture.dispose();
                return;
            }
            window.clearTimeout(timeout);
            resolve(texture);
        }, undefined, (error) => {
            if (timedOut) return;
            window.clearTimeout(timeout);
            reject(error);
        });
    });
}

export const sceneController = {
    async initScene(canvas: HTMLCanvasElement) {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
        const frameCamera = () => {
            camera.position.set(0, 0.32, camera.aspect < 0.8 ? 4.2 : 3.15);
            camera.lookAt(0, 0.32, 0);
            camera.updateProjectionMatrix();
        };
        frameCamera();

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
        const frameTimer = new GpuTimer(renderer.getContext() as WebGL2RenderingContext);
        let frameTimingEnabled = false;
        let renderedFrames = 0;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.localClippingEnabled = true;

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('/draco/');
        const modelLoader = new GLTFLoader();
        modelLoader.setDRACOLoader(dracoLoader);
        const textureLoader = new THREE.TextureLoader();
        let skyEnvironment: THREE.DataTexture;
        let glb: Awaited<ReturnType<typeof modelLoader.loadAsync>>;
        let backTexture: THREE.Texture;
        try {
            [skyEnvironment, glb, backTexture] = await Promise.all([
                new EXRLoader().loadAsync(skyEnvironmentUrl),
                modelLoader.loadAsync(pokeballUrl),
                textureLoader.loadAsync('/textures/artwork_back.webp'),
            ]);
        } catch (error) {
            renderer.dispose();
            throw error;
        } finally {
            dracoLoader.dispose();
        }
        skyEnvironment.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = skyEnvironment;
        scene.backgroundIntensity = 0.65;
        const pmrem = new THREE.PMREMGenerator(renderer);
        const environmentTarget = pmrem.fromEquirectangular(skyEnvironment);
        scene.environment = environmentTarget.texture;
        scene.environmentIntensity = 0.8;
        pmrem.dispose();

        scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
        keyLight.position.set(1.5, 2, 3);
        scene.add(keyLight);
        const revealFill = new THREE.PointLight(0xe879f9, 0, 3.0);
        revealFill.position.set(0, 0.3, 0.25);
        scene.add(revealFill);

        scene.add(glb.scene);
        const occluders: THREE.Object3D[] = [];
        glb.scene.traverse(object => occluders.push(object));

        const frontMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
        const backMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
        const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x192654, transparent: true, depthWrite: false, opacity: 0, toneMapped: false });
        backTexture.colorSpace = THREE.SRGBColorSpace;
        backMaterial.map = backTexture;
        backMaterial.needsUpdate = true;
        frontMaterial.map = backTexture;
        frontMaterial.needsUpdate = true;

        const card = new THREE.Mesh(createCardGeometry(), [
            edgeMaterial, edgeMaterial, edgeMaterial, edgeMaterial, frontMaterial, backMaterial,
        ]);
        card.position.set(0, 0.03, 0.26);
        card.rotation.set(0, THREE.MathUtils.degToRad(-70), THREE.MathUtils.degToRad(-8));
        card.scale.setScalar(0.26);
        card.renderOrder = 3;
        glb.scene.add(card);

        const lid = glb.scene.getObjectByName('button_low001');
        if (!lid) throw new Error('Poké Ball lid not found in GLB');
        const lidClosedX = lid.rotation.x;
        const degrees = THREE.MathUtils.degToRad;
        const smokeBoundary = new SmokeBoundarySampler(glb.scene, lid);

        const psychic = new PsychicEffect(card, window.innerWidth < 700);
        psychic.root.traverse((object) => { object.renderOrder = 2; });
        glb.scene.add(psychic.root);
        let electric: ElectricEffect | undefined;
        let grass: GrassEffect | undefined;
        let bug: BugEffect | undefined;
        let flying: FlyingEffect | undefined;
        let fire: FireEffect | undefined;
        let water: WaterEffect | undefined;
        let ice: IceEffect | undefined;
        let fighting: FightingEffect | undefined;
        let ground: GroundEffect | undefined;
        let rock: RockEffect | undefined;
        let poison: PoisonEffect | undefined;
        let fogEffect: IceEffect | FightingEffect | GroundEffect | PoisonEffect | undefined;
        const preparedFog = new Set<PokemonRevealEffect>();
        const fogVolumes = new Map<'ice' | 'fighting' | 'poison' | 'ground', GpuSmokeMist>();
        let mist: GpuSmokeMist | undefined;
        let depthTarget: THREE.WebGLRenderTarget | undefined;
        const depthMaterial = new THREE.MeshDepthMaterial();
        depthMaterial.colorWrite = false;
        depthMaterial.toneMapped = false;
        const depthMaterials = new Map<THREE.Side, THREE.MeshDepthMaterial>([[THREE.FrontSide, depthMaterial]]);
        const depthFor = (material: THREE.Material) => {
            let result = depthMaterials.get(material.side);
            if (!result) { result = depthMaterial.clone(); result.side = material.side; depthMaterials.set(material.side, result); }
            return result;
        };
        let mistSource: THREE.Object3D | undefined;
        const hiddenForDepth: THREE.Object3D[] = [];
        let activeEffect: PokemonRevealEffect = psychic;

        let disposed = false;
        let cardImageRequest = 0;
        let running = false;
        let playbackWanted = false;
        let playbackEpoch = 0;
        let buffering = false;
        let lastShownTime = 0;
        const bufferSize = new THREE.Vector2();
        renderer.info.autoReset = false;
        const render = () => {
            if (disposed || document.hidden) return;
            if (mist instanceof GpuSmokeMist && fogEffect && !mist.hasFrame(timeline.time())) {
                if (!buffering) {
                    buffering = true;
                    const desired = timeline.time(), epoch = playbackEpoch;
                    timeline.pause(lastShownTime, true); running = false; renderer.setAnimationLoop(null);
                    void mist.prepare(desired).then(() => {
                        if (disposed || epoch !== playbackEpoch) return;
                        buffering = false;
                        timeline.time(desired, true);
                        render();
                        if (playbackWanted && !document.hidden) { timeline.play(); startRender(); }
                    }).catch(error => { buffering = false; console.error('Could not prepare smoke frame', error); });
                }
                return;
            }
            lastShownTime = timeline.time();
            renderedFrames++;
            if (frameTimingEnabled) frameTimer.begin();
            try {
            renderer.info.reset();
            activeEffect.update(timeline.time(), window.innerHeight * renderer.getPixelRatio());
            card.visible = true;
            revealFill.intensity = activeEffect.fillLightIntensity;
            if (activeEffect === rock || activeEffect === bug || activeEffect === flying || activeEffect === water || fogEffect) {
                glb.scene.updateWorldMatrix(true, false);
                revealFill.position.copy(activeEffect.fillLightPosition).applyMatrix4(glb.scene.matrixWorld);
            }
            if (mist && depthTarget) {
                const hasFog = Boolean(fogEffect);
                mist.mesh.visible = false;
                if (hasFog && timeline.time() > 0.008 && timeline.time() < SMOKE_DURATION) {
                    hiddenForDepth.length = 0;
                    const cardOpaque = fogEffect!.cardDepthVisible || (frontMaterial.opacity >= 0.999 && backMaterial.opacity >= 0.999);
                    for (const object of [cardOpaque ? undefined : card, psychic.root, electric?.root, grass?.root, bug?.root, flying?.root, fire?.root, water?.root]) {
                        if (object?.visible) { hiddenForDepth.push(object); object.visible = false; }
                    }
                    const background = scene.background;
                    const meshes = [...occluders.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh), ...(cardOpaque ? [card] : [])];
                    const saved = meshes.map(mesh => mesh.material);
                    try {
                        scene.background = null;
                        meshes.forEach(mesh => { mesh.material = Array.isArray(mesh.material) ? mesh.material.map(depthFor) : depthFor(mesh.material); });
                        renderer.setRenderTarget(depthTarget);
                        fogEffect!.withFogDepth(() => renderer.render(scene, camera));
                    } finally {
                        meshes.forEach((mesh, i) => { mesh.material = saved[i]!; });
                        renderer.setRenderTarget(null);
                        scene.background = background;
                        hiddenForDepth.forEach(object => { object.visible = true; });
                    }
                }
                if (hasFog) {
                    if (mist instanceof GpuSmokeMist) {
                        glb.scene.updateWorldMatrix(true, true);
                        mist.setOcclusionRevision(occluders.map(object => {
                            const geometry = object instanceof THREE.Mesh ? object.geometry as THREE.BufferGeometry : undefined;
                            const position = geometry?.getAttribute('position');
                            return [object.visible, ...object.matrixWorld.elements, geometry?.id,
                                position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position?.version, geometry?.index?.version,
                                geometry?.drawRange.start, geometry?.drawRange.count].join(',');
                        }).join(';') + `:${fogEffect!.fogDepthRevision}:${card.visible}:${frontMaterial.opacity}:${card.matrixWorld.elements.join(',')}`);
                    }
                    renderer.getDrawingBufferSize(bufferSize);
                    mist.update(timeline.time(), Math.abs(lid.rotation.x-lidClosedX)/degrees(45), mistSource!, camera, depthTarget.depthTexture!);
                }
            }
            renderer.render(scene, camera);
            if (fogEffect) mist?.render(renderer, camera);
            } finally {
                if (frameTimingEnabled) frameTimer.end();
            }
        };
        const startRender = () => {
            if (running) return;
            running = true;
            renderer.setAnimationLoop(render);
        };
        const stopRender = () => {
            running = false;
            renderer.setAnimationLoop(null);
            render();
        };
        const finishRender = () => {
            playbackWanted = false;
            activeEffect.finish();
            stopRender();
            render();
        };

        const createTimeline = (reveal: RevealType) => {
            const next = gsap.timeline({ paused: true, onStart: startRender, onComplete: finishRender });
            const openingDuration = reveal === 'rock' || reveal === 'flying' || reveal === 'electric' || reveal === 'fire' || reveal === 'water' || reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison' ? SMOKE_OPENING.duration : 1.90;
            next.to(lid.rotation, { x: lidClosedX - degrees(SMOKE_OPENING.lidDegrees), duration: openingDuration, ease: 'power1.out' }, 0);
            next.to(glb.scene.rotation, { x: degrees(SMOKE_OPENING.bodyDegrees), duration: openingDuration, ease: 'power1.out' }, 0);
            activeEffect.addToTimeline(next);
            next.to(card.position, { y: reveal === 'rock' || reveal === 'bug' || reveal === 'flying' || reveal === 'water' || reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison' ? 0.37 : 0.40, z: 0.50, duration: CARD_REVEAL_TIMING.morphDuration, ease: 'power2.out' }, CARD_REVEAL_TIMING.morph);
            next.to(card.rotation, { x: degrees(-4), y: 0, z: 0, duration: CARD_REVEAL_TIMING.complete - CARD_REVEAL_TIMING.rotation, ease: 'power1.out' }, CARD_REVEAL_TIMING.rotation);
            const cardScale = reveal === 'rock' || reveal === 'bug' || reveal === 'flying' || reveal === 'water' || reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison' ? 0.94 : 1.18;
            next.to(card.scale, { x: cardScale, y: cardScale, z: cardScale, duration: CARD_REVEAL_TIMING.morphDuration, ease: 'power2.out' }, CARD_REVEAL_TIMING.morph);
            next.to([frontMaterial, backMaterial, edgeMaterial], { opacity: 1, duration: CARD_REVEAL_TIMING.fade - CARD_REVEAL_TIMING.image, ease: reveal === 'fighting' ? 'power4.out' : reveal === 'ground' ? 'power3.out' : 'power2.inOut' }, CARD_REVEAL_TIMING.image);
            return next;
        };
        let timeline = createTimeline('psychic');

        const resize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            frameCamera();
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.getDrawingBufferSize(bufferSize);
            depthTarget?.setSize(bufferSize.x, bufferSize.y);
            if (!running) render();
        };
        window.addEventListener('resize', resize);
        const visibility = () => {
            if (document.hidden) { timeline.pause(); running = false; renderer.setAnimationLoop(null); }
            else {
                const epoch = playbackEpoch;
                void (mist && fogEffect ? mist.prepare(timeline.time()) : Promise.resolve()).then(() => {
                    if (!disposed && epoch === playbackEpoch && !document.hidden) {
                        render();
                        if (playbackWanted) { timeline.play(); startRender(); }
                    }
                });
            }
        };
        document.addEventListener('visibilitychange', visibility);
        render();

        return {
            // Used by the development preview only; no debug handles in production.
            debug: import.meta.env.DEV ? {
                async seek(time: number) {
                    if (disposed || !Number.isFinite(time)) return;
                    const epoch = ++playbackEpoch;
                    playbackWanted = false; buffering = false; running = false; renderer.setAnimationLoop(null);
                    timeline.pause();
                    if (mist instanceof GpuSmokeMist && fogEffect) await mist.prepare(time);
                    if (disposed || epoch !== playbackEpoch) return;
                    timeline.pause(0, true);
                    activeEffect.reset();
                    timeline.time(THREE.MathUtils.clamp(time, 0, timeline.duration()), true);
                    if (time >= timeline.duration()) activeEffect.finish();
                    stopRender();
                },
                /** Resume the development preview, optionally in slow motion. */
                resume(rate = 1) {
                    if (disposed || !Number.isFinite(rate) || rate <= 0 || timeline.time() >= timeline.duration()) return;
                    playbackWanted = true;
                    if (document.hidden || buffering) return;
                    timeline.timeScale(rate).play();
                    startRender();
                },
                snapshot() {
                    return {
                        time: timeline.time(), duration: timeline.duration(), running, disposed, buffering,
                        effect: activeEffect.root.name,
                        memory: { ...renderer.info.memory }, calls: renderer.info.render.calls,
                        programs: renderer.info.programs?.length ?? 0,
                        cardScale: card.scale.x,
                        frameGpu: frameTimer.stats(),
                        renderedFrames,
                        flying: flying?.getDebugInfo(),
                        bug: bug?.getDebugInfo(),
                        fighting: fighting?.getDebugInfo(),
                        ground: ground?.getDebugInfo(),
                        rock: rock?.getDebugInfo(),
                        poison: poison?.getDebugInfo(),
                        mist: mist ? { visible:mist.mesh.visible,kind:'gpu',...mist.getDebugInfo() } : undefined,
                    };
                },
                setFlyingFeathers(visible: boolean) { flying?.setFeathersVisible(visible); render(); },
                setBlackBackground(enabled: boolean) { scene.background = enabled ? null : skyEnvironment; render(); },
                model: glb.scene,
                card,
                mistSettings: () => mist?.settings,
                setMistDebugView(view: 'lighting' | 'density' | 'velocity') {
                    if (mist instanceof GpuSmokeMist) { mist.debugView = view; render(); }
                },
                setMistOptimization(mode: 'reference' | 'optimized') {
                    if (mist instanceof GpuSmokeMist) { mist.mode = mode; render(); }
                },
                mistPixels: () => mist instanceof GpuSmokeMist ? mist.readPixels(renderer) : undefined,
                setSmokeFrameTiming(enabled: boolean) { frameTimingEnabled = enabled;frameTimer.clear(); },
                smokeDiagnostics: () => mist instanceof GpuSmokeMist ? mist.simulation?.diagnostics() : undefined,
                exportMistFrame: (frame: number) => mist instanceof GpuSmokeMist ? mist.exportFrame(frame) : undefined,
                replayFrameData: () => mist instanceof GpuSmokeMist ? mist.replay?.frameData() : undefined,
                readSmokeField: () => mist instanceof GpuSmokeMist ? mist.readField() : undefined,
                clearSmokeReadback: () => { if (mist instanceof GpuSmokeMist) mist.clearReadback(); },
                async setMistSource(source: 'live' | 'replay') {
                    if (!(mist instanceof GpuSmokeMist)) return;
                    const epoch = ++playbackEpoch, resume = playbackWanted;
                    playbackWanted = false; buffering = false; timeline.pause(); running = false; renderer.setAnimationLoop(null);
                    await mist.setSource(source);
                    await mist.prepare(timeline.time());
                    if (disposed || epoch !== playbackEpoch) return;
                    render();
                    if (resume && !document.hidden) { playbackWanted = true; timeline.play(); startRender(); }
                },
                resetSmokeTiming() { frameTimer.clear();if(mist instanceof GpuSmokeMist){mist.timer.clear();mist.simulation?.timer.clear();mist.replay?.clearTiming();mist.occupancy.timer.clear();} },
                /** Side view is for occlusion QA; normal playback retains the original camera. */
                sideView(enabled: boolean) {
                    if (enabled) { camera.position.set(3.0,0.6,2.0);camera.lookAt(0,0.1,0); }
                    else frameCamera();
                    render();
                },
            } : undefined,
            async setCardImage(image: string) {
                const request = ++cardImageRequest;
                const texture = await loadCardTexture(image);
                if (disposed || request !== cardImageRequest) { texture.dispose(); return false; }
                texture.colorSpace = THREE.SRGBColorSpace;
                if (frontMaterial.map !== backTexture) frontMaterial.map?.dispose();
                frontMaterial.map = texture;
                frontMaterial.needsUpdate = true;
                if (!running) render();
                return true;
            },
            async play(reveal: RevealType = 'psychic') {
                if (disposed) return;
                const epoch = ++playbackEpoch;
                playbackWanted = false; buffering = false; running = false; renderer.setAnimationLoop(null);
                timeline.kill();
                if (reveal === 'electric' && !electric) {
                    electric = new ElectricEffect(card, window.innerWidth < 700);
                    electric.root.traverse((object) => { object.renderOrder = 2; });
                    glb.scene.add(electric.root);
                }
                if (reveal === 'grass' && !grass) {
                    grass = new GrassEffect(card, window.innerWidth < 700);
                    grass.root.traverse((object) => { object.renderOrder = 2; });
                    glb.scene.add(grass.root);
                }
                if (reveal === 'bug' && !bug) {
                    bug = new BugEffect(card, window.innerWidth < 700);
                    glb.scene.add(bug.root);
                }
                if (reveal === 'flying' && !flying) {
                    flying = new FlyingEffect(card, window.innerWidth < 700);
                    glb.scene.add(flying.root);
                }
                if (reveal === 'fire' && !fire) {
                    fire = new FireEffect(card, window.innerWidth < 700);
                    fire.root.traverse((object) => { object.renderOrder = 2; });
                    glb.scene.add(fire.root);
                }
                if (reveal === 'water' && !water) {
                    water = new WaterEffect(card, skyEnvironment, window.innerWidth < 700);
                    glb.scene.add(water.root);
                }
                if (reveal === 'ice' && !ice) {
                    ice = new IceEffect(card, skyEnvironment, renderer, window.innerWidth < 700);
                    glb.scene.add(ice.root);
                }
                if (reveal === 'poison' && !poison) {
                    poison = new PoisonEffect(card, skyEnvironment, window.innerWidth < 700);
                    glb.scene.add(poison.root);
                }
                if (reveal === 'ground' && !ground) {
                    ground = new GroundEffect(card, window.innerWidth < 700);
                    glb.scene.add(ground.root);
                }
                if (reveal === 'rock' && !rock) {
                    rock = new RockEffect(card, window.innerWidth < 700);
                    glb.scene.add(rock.root);
                }
                if (reveal === 'fighting' && !fighting) {
                    fighting = new FightingEffect(card, window.innerWidth < 700);
                    glb.scene.add(fighting.root);
                }
                if ((reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison') && !fogVolumes.has(reveal)) {
                    mist = new GpuSmokeMist(renderer,camera,smokeBoundary,window.innerWidth<700,
                        import.meta.env.DEV && new URLSearchParams(location.search).get('smokeSource') === 'live' ? 'live' : 'replay', reveal);
                    fogVolumes.set(reveal, mist);
                }
                if ((reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison') && !depthTarget) {
                    // Preserve the root-space opening coordinates while following the actual bottom node.
                    mistSource = new THREE.Object3D();
                    mistSource.name = 'BowlMistSource';
                    glb.scene.add(mistSource);
                    const bowl = glb.scene.getObjectByName('bottom_low001')
                        ?? glb.scene.getObjectByName('bottom_low001_pokeball_0');
                    if (!bowl) throw new Error('Poké Ball bowl not found in GLB');
                    bowl.attach(mistSource);
                    renderer.getDrawingBufferSize(bufferSize);
                    depthTarget = new THREE.WebGLRenderTarget(bufferSize.x, bufferSize.y, {
                        depthTexture: new THREE.DepthTexture(bufferSize.x, bufferSize.y),
                        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
                    });
                }
                activeEffect.setActive(false);
                activeEffect = reveal === 'rock' ? rock! : reveal === 'bug' ? bug! : reveal === 'flying' ? flying! : reveal === 'electric' ? electric! : reveal === 'grass' ? grass!
                    : reveal === 'fire' ? fire! : reveal === 'water' ? water! : reveal === 'ice' ? ice! : reveal === 'ground' ? ground! : reveal === 'fighting' ? fighting! : reveal === 'poison' ? poison! : psychic;
                fogEffect = reveal === 'ice' ? ice : reveal === 'ground' ? ground : reveal === 'fighting' ? fighting : reveal === 'poison' ? poison : undefined;
                mist = reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison' ? fogVolumes.get(reveal) : undefined;
                revealFill.color.copy(activeEffect.fillLightColor);
                revealFill.position.copy(activeEffect.fillLightPosition);
                activeEffect.setActive(true);
                activeEffect.reset();
                glb.scene.rotation.set(0, 0, 0);
                lid.rotation.x = lidClosedX;
                card.position.set(0, 0.03, 0.26);
                card.rotation.set(0, degrees(-70), degrees(-8));
                card.scale.setScalar(0.26);
                frontMaterial.opacity = backMaterial.opacity = edgeMaterial.opacity = 0;
                timeline = createTimeline(reveal);
                if (reveal === 'rock') {
                    await rock!.ready;
                    if (disposed || epoch !== playbackEpoch) return;
                }
                if (mist && fogEffect) {
                    if (reveal === 'ground') {
                        await ground!.ready;
                        if (disposed || epoch !== playbackEpoch) return;
                    }
                    await mist.prepare(0);
                    if (disposed || epoch !== playbackEpoch) return;
                    mist.reset();
                    if (!preparedFog.has(fogEffect)) {
                        if (reveal === 'ice') await renderer.compileAsync(ice!.root, camera, scene);
                        else await renderer.compileAsync(fogEffect.root, camera, scene);
                        if (disposed || epoch !== playbackEpoch) return;
                        await renderer.compileAsync(card, camera, scene);
                        if (disposed || epoch !== playbackEpoch) return;
                        await fogEffect.compileFogDepth(renderer, camera, scene);
                        if (disposed || epoch !== playbackEpoch) return;
                        for (const object of [...occluders, card]) {
                            if (!(object instanceof THREE.Mesh)) continue;
                            const material = object.material;
                            let compiled: Promise<unknown>;
                            try {
                                object.material = Array.isArray(material) ? material.map(depthFor) : depthFor(material);
                                compiled = renderer.compileAsync(object, camera, scene);
                            } finally { object.material = material; }
                            await compiled;
                            if (disposed || epoch !== playbackEpoch) return;
                        }
                        await mist.warmup();
                        if (disposed || epoch !== playbackEpoch) return;
                        preparedFog.add(fogEffect);
                    }
                }
                if (disposed || epoch !== playbackEpoch) return;
                lastShownTime = 0;
                if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    if (reveal === 'ground') {
                        // Ground prepares its final frame before buffering can rewind the timeline.
                        if (mist) await mist.prepare(timeline.duration());
                        if (disposed || epoch !== playbackEpoch) return;
                        timeline.progress(1, true);
                    } else timeline.progress(1);
                    finishRender();
                } else {
                    playbackWanted = true;
                    timeline.play(0);
                    if (document.hidden) visibility();
                }
            },
            stop() {
                if (disposed) return;
                playbackWanted = false; playbackEpoch++; buffering = false;
                timeline.pause();
                stopRender();
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                playbackWanted = false; playbackEpoch++;
                running = false;
                cardImageRequest++;
                timeline.kill();
                renderer.setAnimationLoop(null);
                window.removeEventListener('resize', resize);
                document.removeEventListener('visibilitychange', visibility);
                psychic.dispose();
                electric?.dispose();
                grass?.dispose();
                bug?.dispose();
                flying?.dispose();
                fire?.dispose();
                water?.dispose();
                ice?.dispose();
                fighting?.dispose();
                ground?.dispose();
                rock?.dispose();
                poison?.dispose();
                fogVolumes.forEach(volume => volume.dispose());
                depthTarget?.dispose();
                depthMaterials.forEach(material => material.dispose());
                card.geometry.dispose();
                if (frontMaterial.map !== backTexture) frontMaterial.map?.dispose();
                backTexture.dispose();
                frontMaterial.dispose();
                backMaterial.dispose();
                edgeMaterial.dispose();
                scene.background = null;
                scene.environment = null;
                skyEnvironment.dispose();
                environmentTarget.dispose();
                const disposedGeometries = new Set<THREE.BufferGeometry>();
                const disposedMaterials = new Set<THREE.Material>();
                const disposedTextures = new Set<THREE.Texture>();
                glb.scene.traverse((object) => {
                    if (!(object instanceof THREE.Mesh) || object === card) return;
                    if (!disposedGeometries.has(object.geometry)) {
                        object.geometry.dispose();
                        disposedGeometries.add(object.geometry);
                    }
                    const materials = Array.isArray(object.material) ? object.material : [object.material];
                    materials.forEach((material) => {
                        if (disposedMaterials.has(material)) return;
                        Object.values(material).forEach((value) => {
                            if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
                                value.dispose();
                                disposedTextures.add(value);
                            }
                        });
                        material.dispose();
                        disposedMaterials.add(material);
                    });
                });
                renderer.dispose();
                frameTimer.dispose();
                renderer.forceContextLoss();
            },
        };
    },
};
