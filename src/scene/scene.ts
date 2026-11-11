import { GhostEffect } from '../effects/ghost';
import { DarkEffect } from '../effects/dark';
import { SteelEffect } from '../effects/steel';
import { GroundEffect } from '../effects/ground';
import { RockEffect } from '../effects/rock';
import { BugEffect } from '../effects/bug';
import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import gsap from 'gsap';
import GUI from 'lil-gui';

import { loadPokeball } from './pokeballAsset';
import skyEnvironmentUrl from '../assets/sky/ferndale_studio_12_4k.hdr?url';
import { PsychicEffect } from '../effects/psychic';
import { ElectricEffect } from '../effects/electric';
import { GrassEffect } from '../effects/grass';
import { FlyingEffect } from '../effects/flying';
import { DragonEffect } from '../effects/dragon';
import { FairyEffect } from '../effects/fairy';
import { NormalEffect } from '../effects/normal';
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
import { REVEAL_TYPES, type PokemonRevealEffect, type RevealType, type RevealPreparationProgress } from '../effects/types';
import { cleanSmokeCache, prefetchSmokeClips } from '../effects/smokeReplay';
import { prefetchEffectTextures } from '../effects/effectTextures';
import { CardTextureCache } from './cardTextureCache';
import { createCardGeometry } from './card';

const BALL_MOTION = {
    throwDuration: 1.20, settleDuration: 0.10, openingDuration: SMOKE_OPENING.duration,
    entryDepthMultiplier: 7, controlDepthMultiplier: 4.9,
    entryScreenY: 0.72, controlScreenX: 0.31, controlScreenY: 0.23,
    flightBrakeStart: 0.78, spinBrakeStart: 0.72,
    dropDuration: 0.65, spinTurns: 2, spinAxisTiltDegrees: 15, dropTiltX: 7, dropTiltZ: -5,
} as const;

export type PresentationMode = 'during' | 'after';
const CARD_PRESENTATION = {
    duration: 0.9, lidDegrees: 110, heightFraction: 0.55, margin: 24, forwardDistance: 0.65, clearanceLift: 0.65,
    revealY: 0.37, revealZ: 0.50, revealScale: 1.18,
} as const;

/** Constant travel feeds a short cubic brake with continuous velocity at the join. */
function coastThenBrake(progress: number, brakeStart: number): number {
    const coastEnd = brakeStart / (brakeStart + (1 - brakeStart) / 3);
    if (progress <= brakeStart) return progress * coastEnd / brakeStart;
    return 1 - (1 - coastEnd) * ((1 - progress) / (1 - brakeStart)) ** 3;
}

const hdrEnvironmentOptions = Object.fromEntries(
    Object.entries(import.meta.glob<string>('../assets/sky/*.hdr', {
        eager: true, query: '?url', import: 'default',
    })).map(([path, url]) => [path.split('/').pop()!.replace(/\.hdr$/i, ''), url]),
);

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
    async initScene(canvas: HTMLCanvasElement, { onReplay }: { onReplay?: () => void } = {}) {
        const mobile = window.innerWidth < 700;
        const cardTextures = new CardTextureCache(loadCardTexture);
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

        const releaseClipPrefetch = prefetchSmokeClips(mobile);
        const releaseTexturePrefetch = prefetchEffectTextures(mobile);

        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('/draco/');
        const modelLoader = new GLTFLoader();
        modelLoader.setDRACOLoader(dracoLoader);
        const textureLoader = new THREE.TextureLoader();
        let skyEnvironment: THREE.DataTexture;
        let glb: Awaited<ReturnType<typeof modelLoader.loadAsync>>;
        let backTexture: THREE.Texture;
        let initializationFailed = false;
        const initializedAssets: (() => void)[] = [];
        const releaseModel = (model: Awaited<ReturnType<typeof modelLoader.loadAsync>>) => {
            const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
            model.scene.traverse(object => {
                if (!(object instanceof THREE.Mesh)) return;
                geometries.add(object.geometry);
                for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
                    materials.add(material);
                    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
                }
            });
            geometries.forEach(asset => asset.dispose()); materials.forEach(asset => asset.dispose()); textures.forEach(asset => asset.dispose());
        };
        const initialAsset = <T>(promise: Promise<T>, release: (asset: T) => void): Promise<T> => new Promise((resolve, reject) => {
            let timedOut = false;
            const timeout = window.setTimeout(() => { timedOut = true; reject(new Error('Scene asset timed out')); }, 60000);
            promise.then(asset => {
                window.clearTimeout(timeout);
                if (timedOut || initializationFailed) { release(asset); reject(new Error('Scene initialization cancelled')); return; }
                initializedAssets.push(() => release(asset)); resolve(asset);
            }, error => { window.clearTimeout(timeout); reject(error); });
        });
        try {
            [skyEnvironment, glb, backTexture] = await Promise.all([
                initialAsset(new HDRLoader().loadAsync(skyEnvironmentUrl), texture => texture.dispose()),
                initialAsset(loadPokeball(modelLoader), releaseModel),
                initialAsset(textureLoader.loadAsync('/textures/artwork_back.webp'), texture => texture.dispose()),
            ]);
        } catch (error) {
            initializationFailed = true;
            initializedAssets.forEach(release => release());
            releaseClipPrefetch(); releaseTexturePrefetch();
            frameTimer.dispose(); cardTextures.dispose();
            renderer.dispose();
            throw error;
        } finally {
            dracoLoader.dispose();
        }
        skyEnvironment.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = skyEnvironment;
        scene.backgroundIntensity = 0.65;
        const pmrem = new THREE.PMREMGenerator(renderer);
        let environmentTarget = pmrem.fromEquirectangular(skyEnvironment);
        scene.environment = environmentTarget.texture;
        scene.environmentIntensity = 0.8;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
        scene.add(ambientLight);
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
        keyLight.position.set(1.5, 2, 3);
        scene.add(keyLight);
        const revealFill = new THREE.PointLight(0xe879f9, 0, 3.0);
        revealFill.position.set(0, 0.3, 0.25);
        scene.add(revealFill);

        scene.add(glb.scene);
        const occluders: THREE.Object3D[] = [];
        glb.scene.traverse(object => occluders.push(object));
        // Capture only original GLB meshes, before cards and effect roots join the model hierarchy.
        const ballMeshes = occluders.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
        // Only the original GLB travels. Card/effect coordinates remain in glb.scene.
        const closedBounds = new THREE.Box3().setFromObject(glb.scene);
        const ballCenter = closedBounds.getCenter(new THREE.Vector3());
        const ballRadius = closedBounds.getSize(new THREE.Vector3()).length() / 2;
        const modelChildren = [...glb.scene.children];
        const ballFlight = new THREE.Group();
        ballFlight.name = 'BallFlight';
        const ballSpin = new THREE.Group();
        ballSpin.name = 'BallSpin';
        ballSpin.position.copy(ballCenter);
        const ballOffset = new THREE.Group();
        ballOffset.position.copy(ballCenter).negate();
        glb.scene.add(ballFlight);
        ballFlight.add(ballSpin);
        ballSpin.add(ballOffset);
        modelChildren.forEach(child => ballOffset.add(child));

        // The GLB shares a fully metallic, white-emissive material between lid and bowl.
        // Dragon needs subdued lid emission and blue bounce; retain the exact look for other types.
        const originalBallLook: { mesh: THREE.Mesh; original: THREE.MeshStandardMaterial; dragon: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; fairy: THREE.MeshStandardMaterial; normal: THREE.MeshStandardMaterial }[] = [];
        glb.scene.traverse(object => {
            if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial)) return;
            const material = object.material.clone();
            const bowl = object.name.startsWith('bottom_');
            material.metalness = bowl ? 0.30 : 0.90;
            material.roughness = bowl ? 0.48 : 0.65;
            material.envMapIntensity = bowl ? 1 : 0.35;
            material.emissive.set(0x365685);
            material.emissiveIntensity = 0.32;
            if (bowl) material.color.set(0xdce3ff);
            const darkMaterial = object.material.clone();
            darkMaterial.metalness = bowl ? 0.22 : 0.80;
            darkMaterial.roughness = bowl ? 0.38 : 0.48;
            darkMaterial.emissive.set(0x555d6b);
            darkMaterial.emissiveIntensity = 0.16;
            const fairyMaterial = object.material.clone();
            fairyMaterial.metalness = bowl ? 0.24 : 0.85;
            fairyMaterial.roughness = bowl ? 0.42 : 0.55;
            fairyMaterial.emissive.set(0x4a2236);
            fairyMaterial.emissiveIntensity = 0.14;
            if (bowl) fairyMaterial.color.set(0xeee1e9);
            const normalMaterial = object.material.clone();
            normalMaterial.metalness = bowl ? 0.20 : 0.85;
            normalMaterial.roughness = bowl ? 0.44 : 0.55;
            normalMaterial.emissive.set(0x45413c);
            normalMaterial.emissiveIntensity = 0.10;
            if (bowl) normalMaterial.color.set(0xeeeae5);
            originalBallLook.push({ mesh: object, original: object.material, dragon: material, dark: darkMaterial, fairy: fairyMaterial, normal: normalMaterial });
        });
        const setDragonLook = (enabled: boolean) => {
            scene.environmentIntensity = enabled ? 0.50 : 0.8;
            ambientLight.intensity = enabled ? 0.30 : 0.65;
            keyLight.intensity = enabled ? 1.6 : 2.3;
            for (const original of originalBallLook) {
                original.mesh.material = enabled ? original.dragon : original.original;
            }
        };
        // Only Dark changes the model's white emission, so the existing local light can reflect red.
        const setDarkLook = () => {
            for (const look of originalBallLook) look.mesh.material = look.dark;
        };
        const setFairyLook = () => {
            for (const look of originalBallLook) look.mesh.material = look.fairy;
        };

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

        const psychic = new PsychicEffect(card, mobile);
        psychic.root.traverse((object) => { object.renderOrder = 2; });
        glb.scene.add(psychic.root);
        let electric: ElectricEffect | undefined;
        let grass: GrassEffect | undefined;
        let bug: BugEffect | undefined;
        let flying: FlyingEffect | undefined;
        let dragon: DragonEffect | undefined;
        let fairy: FairyEffect | undefined;
        let normal: NormalEffect | undefined;
        let fire: FireEffect | undefined;
        let water: WaterEffect | undefined;
        let ice: IceEffect | undefined;
        let fighting: FightingEffect | undefined;
        let ground: GroundEffect | undefined;
        let rock: RockEffect | undefined;
        let poison: PoisonEffect | undefined;
        let ghost: GhostEffect | undefined;
        let dark: DarkEffect | undefined;
        let steel: SteelEffect | undefined;
        let fogEffect: IceEffect | FightingEffect | GroundEffect | PoisonEffect | GhostEffect | undefined;
        const preparedFog = new Set<PokemonRevealEffect>();
        const fogVolumes = new Map<'ice' | 'fighting' | 'poison' | 'ground' | 'ghost', GpuSmokeMist>();
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
        let preparing = false;
        let idle = false;
        let cardImageRequest = 0;
        let running = false;
        let playbackWanted = false;
        let playbackEpoch = 0;
        let buffering = false;
        let lastShownTime = 0;
        type Phase = 'idle' | 'preparing' | 'throw' | 'settle' | 'opening' | 'reveal' | 'focus' | 'drop' | 'presented';
        let phase: Phase = 'idle';
        let motionTimeline: gsap.core.Timeline | undefined;
        let resolvePlayback: ((result: 'completed' | 'cancelled') => void) | undefined;
        let effectFinished = false;
        let carriedEffect: { root: THREE.Group; matrix: THREE.Matrix4 } | undefined;
        const motion = { flight: 0, spin: 0, drop: 0 };
        const animationSettings = { mode: 'after' as PresentationMode };
        let playbackMode: PresentationMode = 'after';
        const presentation = { progress: 0 };
        // GSAP owns the reveal pose; presentation is composed once per render, without accumulating offsets.
        const cardPose = { y: 0.03, z: 0.26, rx: 0, ry: degrees(-70), rz: degrees(-8), scale: 0.26 };
        const focusPosition = new THREE.Vector3(), focusOrigin = new THREE.Vector3();
        const parentScale = new THREE.Vector3(), parentQuaternion = new THREE.Quaternion();
        const focusQuaternion = new THREE.Quaternion(), focusForward = new THREE.Vector3();

        /** Fit a face-on card to the viewport while moving only the card, never the camera. */
        const applyCardPose = () => {
            card.position.set(0, cardPose.y, cardPose.z);
            card.rotation.set(cardPose.rx, cardPose.ry, cardPose.rz);
            card.scale.setScalar(cardPose.scale);
            const progress = presentation.progress;
            if (progress <= 0) return;
            glb.scene.updateWorldMatrix(true, false);
            focusOrigin.set(0, CARD_PRESENTATION.revealY, CARD_PRESENTATION.revealZ).applyMatrix4(glb.scene.matrixWorld);
            camera.getWorldDirection(focusForward);
            const depth = focusOrigin.sub(camera.position).dot(focusForward) - CARD_PRESENTATION.forwardDistance;
            focusPosition.copy(camera.position).addScaledVector(focusForward, depth);
            glb.scene.worldToLocal(focusPosition);
            // Early translation clears the lid before the larger silhouette expands.
            const travel = 1 - (1 - progress) ** 3;
            const grow = progress * progress * (3 - 2 * progress);
            card.position.lerp(focusPosition, travel);
            // Lift over the bowl's front rim, then settle onto the centered presentation pose.
            card.position.y += CARD_PRESENTATION.clearanceLift * Math.sin(Math.PI * travel);
            glb.scene.getWorldQuaternion(parentQuaternion);
            focusQuaternion.copy(parentQuaternion).invert().multiply(camera.quaternion);
            card.quaternion.slerp(focusQuaternion, grow);
            glb.scene.getWorldScale(parentScale);
            const heightFraction = Math.min(CARD_PRESENTATION.heightFraction,
                (window.innerWidth - CARD_PRESENTATION.margin * 2) / (0.7 * window.innerHeight),
                (window.innerHeight - CARD_PRESENTATION.margin * 2) / window.innerHeight);
            const projectedHeight = Math.max(0.01, heightFraction) * 2 * Math.tan(degrees(camera.fov / 2));
            // Front face is half the 0.02-thick card closer to the viewer than its center.
            const targetScale = projectedHeight * depth / (1 + projectedHeight * 0.01) / parentScale.y;
            card.scale.setScalar(THREE.MathUtils.lerp(cardPose.scale, targetScale, grow));
            lid.rotation.x = lidClosedX - degrees(THREE.MathUtils.lerp(SMOKE_OPENING.lidDegrees, CARD_PRESENTATION.lidDegrees, travel));
        };
        const spinTilt = degrees(BALL_MOTION.spinAxisTiltDegrees);
        const spinAxis = new THREE.Vector3(Math.sin(spinTilt), Math.cos(spinTilt), 0);
        const flightStart = new THREE.Vector3(), flightControl = new THREE.Vector3();
        const dropStart = new THREE.Vector3(), dropEnd = new THREE.Vector3();
        let flightRebase = 0, dropRebase = 0;
        const motionPoint = new THREE.Vector3(), targetCenter = new THREE.Vector3();
        const cameraRight = new THREE.Vector3(), cameraUp = new THREE.Vector3(), cameraForward = new THREE.Vector3();
        const bufferSize = new THREE.Vector2();
        renderer.info.autoReset = false;
        /** Share the exact depth-pass state between playback and targeted GPU preparation. */
        const withFogDepthPass = <T>(draw: () => T): T => {
            hiddenForDepth.length = 0;
            const cardOpaque = fogEffect!.cardDepthVisible || (frontMaterial.opacity >= 0.999 && backMaterial.opacity >= 0.999);
            for (const object of [cardOpaque ? undefined : card, psychic.root, electric?.root, grass?.root, bug?.root, flying?.root, fire?.root, water?.root]) {
                if (object?.visible) { hiddenForDepth.push(object); object.visible = false; }
            }
            const background = scene.background, target = renderer.getRenderTarget();
            const meshes = [...ballMeshes, ...(cardOpaque ? [card] : [])];
            const saved = meshes.map(mesh => mesh.material);
            try {
                scene.background = null;
                meshes.forEach(mesh => { mesh.material = Array.isArray(mesh.material) ? mesh.material.map(depthFor) : depthFor(mesh.material); });
                renderer.setRenderTarget(depthTarget!);
                return fogEffect!.withFogDepth(draw);
            } finally {
                meshes.forEach((mesh, i) => { mesh.material = saved[i]!; });
                renderer.setRenderTarget(target);
                scene.background = background;
                hiddenForDepth.forEach(object => { object.visible = true; });
            }
        };
        const throwCamera = camera.clone();
        const backdrop = new THREE.Scene();
        const shellView = new THREE.Vector3();
        const restView = new THREE.Vector3();
        const viewport = new THREE.Vector2();

        /** Shift the lens so the shell keeps its screen path while seen from its resting angle. */
        const renderThrow = () => {
            camera.updateMatrixWorld();
            camera.worldToLocal(ballSpin.getWorldPosition(shellView));
            camera.worldToLocal(glb.scene.localToWorld(restView.copy(ballCenter)));
            const depthRatio = shellView.z / restView.z;
            const shiftX = shellView.x - restView.x * depthRatio;
            const shiftY = shellView.y - restView.y * depthRatio;
            throwCamera.position.set(shiftX, shiftY, 0).applyMatrix4(camera.matrixWorld);
            throwCamera.quaternion.copy(camera.quaternion);
            renderer.getSize(viewport);
            const pixelsPerUnit = viewport.y * camera.projectionMatrix.elements[5] / (-2 * shellView.z);
            throwCamera.setViewOffset(viewport.x, viewport.y, -shiftX * pixelsPerUnit, shiftY * pixelsPerUnit,
                viewport.x, viewport.y);

            // The studio uses the original lens. Only the closed shell needs the shifted projection.
            const background = scene.background;
            backdrop.background = background;
            backdrop.backgroundRotation.copy(scene.backgroundRotation);
            backdrop.backgroundIntensity = scene.backgroundIntensity;
            backdrop.backgroundBlurriness = scene.backgroundBlurriness;
            renderer.render(backdrop, camera);
            const autoClear = renderer.autoClear;
            try {
                scene.background = null;
                renderer.autoClear = false;
                renderer.render(scene, throwCamera);
            } finally {
                renderer.autoClear = autoClear;
                scene.background = background;
                backdrop.background = null;
            }
        };
        const render = () => {
            if (disposed || (document.hidden && !preparing)) return;
            if (idle || phase === 'throw' || phase === 'settle' || phase === 'opening') {
                card.visible = false;
                revealFill.intensity = 0;
                renderer.info.reset();
                renderedFrames++;
                if (phase === 'throw') renderThrow();
                else renderer.render(scene, camera);
                return;
            }
            if (mist instanceof GpuSmokeMist && fogEffect && !mist.hasFrame(timeline.time())) {
                if (preparing) return; // The startup queue, not playback buffering, owns preparation.
                if (!buffering) {
                    buffering = true;
                    const desired = timeline.time(), epoch = playbackEpoch;
                    if (effectFinished) timeline.pause(); else timeline.pause(lastShownTime, true);
                    motionTimeline?.pause(); running = false; renderer.setAnimationLoop(null);
                    void mist.prepare(desired).then(() => {
                        if (disposed || epoch !== playbackEpoch) return;
                        buffering = false;
                        timeline.time(desired, true);
                        render();
                        if (playbackWanted && !document.hidden) {
                            if (phase === 'reveal') timeline.play(); else motionTimeline?.play();
                            startRender();
                        }
                    }).catch(error => {
                        if (disposed || epoch !== playbackEpoch) return;
                        buffering = false; playbackWanted = false;
                        cancelPlayback();
                        console.error('Could not prepare smoke frame', error);
                    });
                }
                return;
            }
            lastShownTime = timeline.time();
            renderedFrames++;
            if (frameTimingEnabled) frameTimer.begin();
            try {
                renderer.info.reset();
                applyCardPose();
                if (!effectFinished) activeEffect.update(timeline.time(), window.innerHeight * renderer.getPixelRatio());
                card.visible = true;
                revealFill.intensity = activeEffect.fillLightIntensity;
                if (activeEffect === normal || activeEffect === fairy || activeEffect === steel || activeEffect === dark || activeEffect === dragon || activeEffect === rock || activeEffect === bug || activeEffect === flying || activeEffect === water || fogEffect) {
                    glb.scene.updateWorldMatrix(true, false);
                    revealFill.position.copy(activeEffect.fillLightPosition).applyMatrix4(glb.scene.matrixWorld);
                }
                if (mist && depthTarget) {
                    const hasFog = Boolean(fogEffect);
                    mist.mesh.visible = false;
                    if (hasFog && timeline.time() > 0.008 && (timeline.time() < SMOKE_DURATION || activeEffect === ghost)) {
                        withFogDepthPass(() => renderer.render(scene, camera));
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
                        mist.update(timeline.time(), THREE.MathUtils.clamp(Math.abs(lid.rotation.x - lidClosedX) / degrees(SMOKE_OPENING.lidDegrees), 0, 1), mistSource!, camera, depthTarget.depthTexture!);
                    }
                }
                renderer.render(scene, camera);
                if (fogEffect) mist?.render(renderer, camera);
                if (activeEffect === ghost && depthTarget?.depthTexture) {
                    ghost!.renderRibbons(renderer, camera, depthTarget.depthTexture);
                }
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
        const completePlayback = () => {
            phase = 'presented';
            playbackWanted = false;
            stopRender();
            resolvePlayback?.('completed');
            resolvePlayback = undefined;
        };
        const cancelPlayback = () => {
            motionTimeline?.kill();
            motionTimeline = undefined;
            timeline.pause();
            resolvePlayback?.('cancelled');
            resolvePlayback = undefined;
        };
        const restoreEffectParent = () => {
            if (!carriedEffect) return;
            glb.scene.add(carriedEffect.root);
            carriedEffect.matrix.decompose(carriedEffect.root.position, carriedEffect.root.quaternion, carriedEffect.root.scale);
            carriedEffect = undefined;
        };
        const resetBall = () => {
            restoreEffectParent();
            ballFlight.position.set(0, 0, 0);
            ballSpin.quaternion.identity();
            glb.scene.rotation.set(0, 0, 0);
            lid.rotation.x = lidClosedX;
            motion.flight = motion.spin = motion.drop = 0;
            presentation.progress = 0;
            flightRebase = dropRebase = 0;
        };
        const openBall = () => {
            ballFlight.position.set(0, 0, 0);
            ballSpin.quaternion.identity();
            glb.scene.rotation.set(degrees(SMOKE_OPENING.bodyDegrees), 0, 0);
            lid.rotation.x = lidClosedX - degrees(SMOKE_OPENING.lidDegrees);
        };
        /** Camera-plane bounds include the whole shell, also when tilted/open. */
        const outsideFrame = (out: THREE.Vector3, entry: boolean) => {
            glb.scene.updateWorldMatrix(true, false);
            targetCenter.copy(ballCenter).applyMatrix4(glb.scene.matrixWorld);
            cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
            cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
            camera.getWorldDirection(cameraForward);
            const presentationDepth = motionPoint.subVectors(targetCenter, camera.position).dot(cameraForward);
            // Physical depth makes the incoming ball small; its geometry/scale stay rigid.
            const depth = presentationDepth * (entry ? BALL_MOTION.entryDepthMultiplier : 1);
            const margin = ballRadius * (entry ? 1.25 : 2);
            const fovSlope = Math.tan(degrees(camera.fov / 2));
            const halfHeight = depth * fovSlope;
            if (entry) {
                const halfWidth = halfHeight * camera.aspect;
                const clearance = margin * (1 + fovSlope * camera.aspect);
                // Extend the entry tangent offscreen so the visible arc crosses the edge at the drawn height.
                const risePerWidth = (BALL_MOTION.entryScreenY - BALL_MOTION.controlScreenY) / BALL_MOTION.controlScreenX;
                const startY = BALL_MOTION.entryScreenY + risePerWidth * clearance / (2 * halfWidth);
                out.copy(camera.position).addScaledVector(cameraForward, depth)
                    .addScaledVector(cameraRight, -halfWidth - clearance)
                    .addScaledVector(cameraUp, (1 - 2 * startY) * halfHeight);
            } else {
                out.copy(targetCenter);
                out.y = camera.position.y - halfHeight - margin * (1 + fovSlope);
            }
        };
        const putBallCenter = (world: THREE.Vector3) => {
            ballFlight.position.copy(world);
            glb.scene.worldToLocal(ballFlight.position).sub(ballCenter);
        };
        const setFlightControl = () => {
            camera.getWorldDirection(cameraForward);
            const presentationDepth = motionPoint.subVectors(targetCenter, camera.position).dot(cameraForward);
            const depth = presentationDepth * BALL_MOTION.controlDepthMultiplier;
            const halfHeight = depth * Math.tan(degrees(camera.fov / 2));
            flightControl.copy(camera.position).addScaledVector(cameraForward, depth)
                .addScaledVector(cameraRight, (2 * BALL_MOTION.controlScreenX - 1) * halfHeight * camera.aspect)
                .addScaledVector(cameraUp, (1 - 2 * BALL_MOTION.controlScreenY) * halfHeight);
            // After resize, use the control point of the remaining quadratic segment.
            flightControl.lerp(targetCenter, flightRebase);
        };
        const updateThrow = () => {
            const t = flightRebase < 1 ? THREE.MathUtils.clamp((motion.flight - flightRebase) / (1 - flightRebase), 0, 1) : 1;
            targetCenter.copy(ballCenter).applyMatrix4(glb.scene.matrixWorld);
            motionPoint.copy(flightStart).multiplyScalar((1 - t) ** 2)
                .addScaledVector(flightControl, 2 * (1 - t) * t).addScaledVector(targetCenter, t * t);
            putBallCenter(motionPoint);
            ballSpin.quaternion.setFromAxisAngle(spinAxis, motion.spin * Math.PI * 2 * BALL_MOTION.spinTurns);
        };
        const updateDrop = () => {
            const t = THREE.MathUtils.clamp((motion.drop - dropRebase) / (1 - dropRebase), 0, 1);
            putBallCenter(motionPoint.lerpVectors(dropStart, dropEnd, t));
            ballSpin.rotation.set(degrees(BALL_MOTION.dropTiltX) * motion.drop, 0, degrees(BALL_MOTION.dropTiltZ) * motion.drop);
        };
        const beginDrop = () => {
            applyCardPose();
            phase = 'drop';
            ballSpin.getWorldPosition(dropStart);
            outsideFrame(dropEnd, false);
            motion.drop = 0; dropRebase = 0;
        };
        const finishReveal = () => {
            if (effectFinished) return;
            effectFinished = true;
            activeEffect.finish();
            // The remaining basin decorations leave with the shell; card manifestations
            // are children of the independent card and never enter this hierarchy.
            activeEffect.root.updateMatrix();
            carriedEffect = { root: activeEffect.root, matrix: activeEffect.root.matrix.clone() };
            ballOffset.attach(activeEffect.root);
            motionTimeline?.kill();
            motionTimeline = gsap.timeline({ paused: true, onComplete: completePlayback });
            if (playbackMode === 'after') {
                phase = 'focus';
                motionTimeline.to(presentation, { progress: 1, duration: CARD_PRESENTATION.duration, ease: 'none' });
                motionTimeline.call(beginDrop);
            } else beginDrop();
            motionTimeline.to(motion, { drop: 1, duration: BALL_MOTION.dropDuration, ease: 'power1.in', onUpdate: updateDrop });
            if (playbackWanted && !document.hidden) { motionTimeline.play(); startRender(); }
        };
        const startThrow = () => {
            resetBall();
            phase = 'throw';
            activeEffect.root.visible = false;
            outsideFrame(flightStart, true);
            setFlightControl();
            updateThrow();
            ballFlight.visible = true;
            const openingStart = BALL_MOTION.throwDuration + BALL_MOTION.settleDuration;
            motionTimeline = gsap.timeline({ paused: true });
            motionTimeline.to(motion, { flight: 1, duration: BALL_MOTION.throwDuration,
                ease: t => coastThenBrake(t, BALL_MOTION.flightBrakeStart), onUpdate: updateThrow }, 0);
            motionTimeline.to(motion, { spin: 1, duration: BALL_MOTION.throwDuration,
                ease: t => coastThenBrake(t, BALL_MOTION.spinBrakeStart), onUpdate: updateThrow }, 0);
            motionTimeline.call(() => { phase = 'settle'; ballFlight.position.set(0, 0, 0); ballSpin.quaternion.identity(); }, [], BALL_MOTION.throwDuration);
            motionTimeline.call(() => { phase = 'opening'; }, [], openingStart);
            motionTimeline.to(lid.rotation, { x: lidClosedX - degrees(SMOKE_OPENING.lidDegrees), duration: BALL_MOTION.openingDuration, ease: 'power1.out' }, openingStart);
            motionTimeline.to(glb.scene.rotation, { x: degrees(SMOKE_OPENING.bodyDegrees), duration: BALL_MOTION.openingDuration, ease: 'power1.out' }, openingStart);
            motionTimeline.eventCallback('onComplete', () => {
                openBall();
                phase = 'reveal';
                activeEffect.setActive(true);
                timeline.play(0);
            });
            if (!document.hidden) { motionTimeline.play(); startRender(); }
        };

        const createTimeline = (reveal: RevealType) => {
            const next = gsap.timeline({ paused: true, onStart: startRender, onComplete: finishReveal });
            activeEffect.addToTimeline(next);
            next.to(cardPose, { y: CARD_PRESENTATION.revealY, z: CARD_PRESENTATION.revealZ, scale: CARD_PRESENTATION.revealScale,
                duration: CARD_REVEAL_TIMING.morphDuration, ease: 'power2.out' }, CARD_REVEAL_TIMING.morph);
            next.to(cardPose, { rx: degrees(-4), ry: 0, rz: 0, duration: CARD_REVEAL_TIMING.complete - CARD_REVEAL_TIMING.rotation, ease: 'power1.out' }, CARD_REVEAL_TIMING.rotation);
            if (playbackMode === 'during') next.to(presentation, { progress: 1, duration: CARD_PRESENTATION.duration, ease: 'none' }, CARD_REVEAL_TIMING.image);
            next.to([frontMaterial, backMaterial, edgeMaterial], { opacity: 1, duration: CARD_REVEAL_TIMING.fade - CARD_REVEAL_TIMING.image, ease: reveal === 'fighting' ? 'power4.out' : reveal === 'ground' ? 'power3.out' : 'power2.inOut' }, CARD_REVEAL_TIMING.image);
            return next;
        };
        let timeline = createTimeline('psychic');

        const resize = () => {
            if (phase === 'throw') { ballSpin.getWorldPosition(flightStart); flightRebase = motion.flight; }
            if (phase === 'drop') { ballSpin.getWorldPosition(dropStart); dropRebase = motion.drop; }
            camera.aspect = window.innerWidth / window.innerHeight;
            frameCamera();
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.getDrawingBufferSize(bufferSize);
            depthTarget?.setSize(bufferSize.x, bufferSize.y);
            if (phase === 'throw') {
                targetCenter.copy(ballCenter).applyMatrix4(glb.scene.matrixWorld);
                setFlightControl();
            }
            if (phase === 'drop' || phase === 'presented') {
                outsideFrame(dropEnd, false);
                if (phase === 'presented') putBallCenter(dropEnd);
            }
            if (!running && !preparing) render();
        };
        window.addEventListener('resize', resize);
        const visibility = () => {
            if (disposed || preparing) return;
            if (document.hidden) { timeline.pause(); motionTimeline?.pause(); running = false; renderer.setAnimationLoop(null); }
            else {
                const epoch = playbackEpoch;
                void (mist && fogEffect ? mist.prepare(timeline.time()) : Promise.resolve()).then(() => {
                    if (!disposed && epoch === playbackEpoch && !document.hidden) {
                        render();
                        if (playbackWanted) {
                            if (phase === 'reveal') timeline.play(); else motionTimeline?.play();
                            startRender();
                        }
                    }
                });
            }
        };
        document.addEventListener('visibilitychange', visibility);
        render();


        const preparedReveals = new Set<RevealType>();
        const preparations = new Map<RevealType, Promise<void>>();
        const preparationMs: Partial<Record<RevealType, number>> = {};
        const preparationGpuMs: Partial<Record<RevealType, number>> = {};
        let preparationQueue = Promise.resolve();
        const selectReveal = (reveal: RevealType) => {
            idle = false;
            timeline.kill();
            resetBall();
            phase = 'preparing';
            effectFinished = false;
            setDragonLook(reveal === 'dragon');
            if (reveal === 'fairy') setFairyLook();
            if (reveal === 'normal') {
                for (const look of originalBallLook) look.mesh.material = look.normal;
            }
            if (reveal === 'dark' || reveal === 'steel') setDarkLook();
            if (reveal === 'electric' && !electric) {
                electric = new ElectricEffect(card, mobile);
                electric.root.traverse((object) => { object.renderOrder = 2; });
                glb.scene.add(electric.root);
            }
            if (reveal === 'grass' && !grass) {
                grass = new GrassEffect(card, mobile);
                grass.root.traverse((object) => { object.renderOrder = 2; });
                glb.scene.add(grass.root);
            }
            if (reveal === 'bug' && !bug) {
                bug = new BugEffect(card, mobile);
                glb.scene.add(bug.root);
            }
            if (reveal === 'flying' && !flying) {
                flying = new FlyingEffect(card, mobile);
                glb.scene.add(flying.root);
            }
            if (reveal === 'dragon' && !dragon) {
                dragon = new DragonEffect(card, mobile);
                glb.scene.add(dragon.root);
            }
            if (reveal === 'fairy' && !fairy) {
                fairy = new FairyEffect(card, mobile);
                glb.scene.add(fairy.root);
            }
            if (reveal === 'normal' && !normal) {
                normal = new NormalEffect(card, mobile);
                glb.scene.add(normal.root);
            }
            if (reveal === 'fire' && !fire) {
                fire = new FireEffect(card, mobile);
                fire.root.traverse((object) => { object.renderOrder = 2; });
                glb.scene.add(fire.root);
            }
            if (reveal === 'water' && !water) {
                water = new WaterEffect(card, skyEnvironment, mobile);
                glb.scene.add(water.root);
            }
            if (reveal === 'ice' && !ice) {
                ice = new IceEffect(card, skyEnvironment, renderer, mobile);
                glb.scene.add(ice.root);
            }
            if (reveal === 'ghost' && !ghost) {
                ghost = new GhostEffect(card, mobile);
                glb.scene.add(ghost.root);
            }
            if (reveal === 'dark' && !dark) {
                dark = new DarkEffect(card, mobile);
                glb.scene.add(dark.root);
            }
            if (reveal === 'steel' && !steel) {
                steel = new SteelEffect(card, mobile);
                glb.scene.add(steel.root);
            }
            if (reveal === 'poison' && !poison) {
                poison = new PoisonEffect(card, skyEnvironment, mobile);
                glb.scene.add(poison.root);
            }
            if (reveal === 'ground' && !ground) {
                ground = new GroundEffect(card, mobile);
                glb.scene.add(ground.root);
            }
            if (reveal === 'rock' && !rock) {
                rock = new RockEffect(card, mobile);
                glb.scene.add(rock.root);
            }
            if (reveal === 'fighting' && !fighting) {
                fighting = new FightingEffect(card, mobile);
                glb.scene.add(fighting.root);
            }
            if ((reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison' || reveal === 'ghost') && !fogVolumes.has(reveal)) {
                mist = new GpuSmokeMist(renderer, camera, smokeBoundary, mobile,
                    import.meta.env.DEV && new URLSearchParams(location.search).get('smokeSource') === 'live' ? 'live' : 'replay', reveal, true);
                fogVolumes.set(reveal, mist);
            }
            if ((reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison' || reveal === 'ghost') && !depthTarget) {
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
            mist?.replay?.deactivate();
            activeEffect.setActive(false);
            activeEffect = reveal === 'normal' ? normal! : reveal === 'fairy' ? fairy! : reveal === 'steel' ? steel! : reveal === 'dark' ? dark! : reveal === 'dragon' ? dragon! : reveal === 'rock' ? rock! : reveal === 'bug' ? bug! : reveal === 'flying' ? flying! : reveal === 'electric' ? electric! : reveal === 'grass' ? grass!
                : reveal === 'fire' ? fire! : reveal === 'water' ? water! : reveal === 'ice' ? ice! : reveal === 'ground' ? ground! : reveal === 'fighting' ? fighting! : reveal === 'ghost' ? ghost! : reveal === 'poison' ? poison! : psychic;
            fogEffect = reveal === 'ice' ? ice : reveal === 'ground' ? ground : reveal === 'fighting' ? fighting : reveal === 'ghost' ? ghost : reveal === 'poison' ? poison : undefined;
            mist = reveal === 'ice' || reveal === 'fighting' || reveal === 'ground' || reveal === 'poison' || reveal === 'ghost' ? fogVolumes.get(reveal) : undefined;
            revealFill.color.copy(activeEffect.fillLightColor);
            revealFill.position.copy(activeEffect.fillLightPosition);
            activeEffect.setActive(true);
            activeEffect.reset();
            openBall();
            Object.assign(cardPose, { y: 0.03, z: 0.26, rx: 0, ry: degrees(-70), rz: degrees(-8), scale: 0.26 });
            card.position.set(0, 0.03, 0.26);
            card.rotation.set(0, degrees(-70), degrees(-8));
            card.scale.setScalar(0.26);
            frontMaterial.opacity = backMaterial.opacity = edgeMaterial.opacity = 0;
            timeline = createTimeline(reveal);

        };
        /** compileAsync collects materials synchronously; restore children before its GPU wait begins.
         * The card owns all eighteen manifestation roots, so compiling its entire subtree would
         * prepare inactive materials with the wrong effect's lighting. These drawables own no lights.
         */
        const compileDrawable = (object: THREE.Object3D) => {
            const children = object.children;
            try {
                object.children = [];
                return renderer.compileAsync(object, camera, scene);
            } finally { object.children = children; }
        };

        /** Compile current effect geometry and only the active manifestation attached to the card. */
        const compileObjects = async (roots: THREE.Object3D[]) => {
            const objects = new Set<THREE.Object3D>();
            const collect = (object: THREE.Object3D) => {
                if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line || object instanceof THREE.Sprite)
                    objects.add(object);
            };
            for (const root of roots) {
                if (root === card) {
                    collect(card);
                    for (const child of card.children) if (child.visible) child.traverse(collect);
                } else root.traverse(collect);
            }
            await Promise.all([...objects].map(compileDrawable));
        };

        /** Prepare one effect once, serializing access to the shared scene and renderer. */
        const prepareReveal = (reveal: RevealType): Promise<void> => {
            if (disposed) return Promise.reject(new Error('Scene disposed'));
            if (preparedReveals.has(reveal)) return Promise.resolve();
            const existing = preparations.get(reveal);
            if (existing) return existing;
            const promise = preparationQueue.then(async () => {
                if (disposed) throw new Error('Scene disposed');
                const started = performance.now();
                let gpuMs = 0;
                preparing = true;
                playbackWanted = false; running = false; renderer.setAnimationLoop(null);
                try {
                    selectReveal(reveal);
                    await Promise.all([
                        reveal === 'rock' ? rock!.ready : undefined,
                        reveal === 'steel' ? steel!.ready : undefined,
                        reveal === 'ground' ? ground!.ready : undefined,
                        mist?.prepare(0),
                    ]);
                    if (disposed) throw new Error('Scene disposed');
                    if (mist && fogEffect) {
                        mist.reset();
                        if (!preparedFog.has(fogEffect)) {
                            const gpuStarted = performance.now();
                            await compileObjects([reveal === 'ice' ? ice!.root : fogEffect.root]);
                            if (disposed) throw new Error('Scene disposed');
                            await compileObjects([card]);
                            if (disposed) throw new Error('Scene disposed');
                            await fogEffect.compileFogDepth(renderer, camera, scene);
                            if (disposed) throw new Error('Scene disposed');
                            for (const object of [...occluders, card]) {
                                if (!(object instanceof THREE.Mesh)) continue;
                                const material = object.material;
                                let compiled: Promise<unknown>;
                                try {
                                    object.material = Array.isArray(material) ? material.map(depthFor) : depthFor(material);
                                    compiled = compileDrawable(object);
                                } finally { object.material = material; }
                                await compiled;
                                if (disposed) throw new Error('Scene disposed');
                            }
                            await mist.warmup();
                            if (disposed) throw new Error('Scene disposed');
                            preparedFog.add(fogEffect);
                            gpuMs += performance.now() - gpuStarted;
                        }
                    }
                    if (disposed) throw new Error('Scene disposed');

                    // Warm actual visible states, including transmission/depth buffers and material variants.
                    for (const time of [0, 1.4, 2.8, 3.5]) {
                        if (disposed) throw new Error('Scene disposed');
                        if (mist && time === 2.8) {
                            // Prepare the handoff's linear depth variant and transient geometry.
                            // Neither pass needs extra smoke segments or another volume draw.
                            const depthStarted = performance.now();
                            timeline.time(CARD_REVEAL_TIMING.image + 0.05, true);
                            activeEffect.update(timeline.time(), window.innerHeight * renderer.getPixelRatio());
                            await withFogDepthPass(() => compileObjects([card]));
                            if (disposed) throw new Error('Scene disposed');
                            withFogDepthPass(() => renderer.render(scene, camera));
                            renderer.render(scene, camera);
                            gpuMs += performance.now() - depthStarted;
                        }
                        if (mist) await mist.prepare(time);
                        const gpuStarted = performance.now();
                        timeline.time(time, true);
                        activeEffect.update(time, window.innerHeight);
                        // compileAsync traverses hidden roots too. Compile only the current effect and
                        // shared objects, with the real scene's environment/lights, before the real render.
                        await compileObjects([activeEffect.root, ...ballMeshes, card]);
                        if (disposed) throw new Error('Scene disposed');
                        render();
                        gpuMs += performance.now() - gpuStarted;
                        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
                    }
                    if (mist) { await mist.prepare(0); mist.reset(); }
                    if (disposed) throw new Error('Scene disposed');
                    selectReveal(reveal);
                    preparationMs[reveal] = performance.now() - started;
                    preparationGpuMs[reveal] = gpuMs;
                    preparedReveals.add(reveal);
                } catch (error) {
                    // A failed fog initialization must be recreated on Retry; successful effects stay resident.
                    if (mist && (reveal === 'ice' || reveal === 'ground' || reveal === 'poison' || reveal === 'fighting' || reveal === 'ghost')) {
                        mist.dispose(); fogVolumes.delete(reveal); mist = undefined;
                        if (fogEffect) preparedFog.delete(fogEffect);
                    }
                    activeEffect.setActive(false);
                    // Texture-ready promises cannot be retried; rebuild only the failed owner.
                    if (reveal === 'ground' || reveal === 'rock' || reveal === 'steel') {
                        activeEffect.root.removeFromParent();
                        activeEffect.dispose();
                        if (reveal === 'ground') { ground = undefined; fogEffect = undefined; }
                        if (reveal === 'rock') rock = undefined;
                        if (reveal === 'steel') steel = undefined;
                        activeEffect = psychic;
                    }
                    throw error;
                } finally {
                    preparing = false;
                    preparations.delete(reveal);
                }
            });
            preparations.set(reveal, promise);
            preparationQueue = promise.catch(() => { });
            return promise;
        };
        /** Startup barrier: all effects are initialized before the search form is enabled. */
        const prepareAllReveals = async (onProgress?: (progress: RevealPreparationProgress) => void) => {
            for (const type of REVEAL_TYPES) {
                await prepareReveal(type);
                onProgress?.({ completed: preparedReveals.size, total: REVEAL_TYPES.length, type });
                await new Promise<void>(resolve => window.setTimeout(resolve, 0));
            }
            releaseClipPrefetch(); releaseTexturePrefetch();
            await cleanSmokeCache();
        };

        const hdrRotation = { x: 0, y: 0, z: 0 };
        const hdrSelection = { file: skyEnvironmentUrl, status: 'Gotowe' };
        let activeHdrUrl = skyEnvironmentUrl;
        let hdrRequest = 0;
        const hdrGui = new GUI({ title: 'Scene controls', autoPlace: false });
        hdrGui.domElement.classList.add('hdr-gui');
        document.body.appendChild(hdrGui.domElement);
        const animationGui = hdrGui.addFolder('Animation');
        const modeControl = animationGui.add(animationSettings, 'mode', { 'During reveal': 'during', 'After reveal': 'after' }).name('Close-up');
        let replayAvailable = false;
        const replayControl = animationGui.add({ replay: () => { if (replayAvailable && !disposed) onReplay?.(); } }, 'replay').name('Replay').disable();
        const hdrFolder = hdrGui.addFolder('Środowisko HDR').close();
        const hdrFileControl = hdrFolder.add(hdrSelection, 'file', hdrEnvironmentOptions).name('Plik HDR');
        const hdrStatusControl = hdrFolder.add(hdrSelection, 'status').name('Status').disable();
        const setHdrStatus = (status: string) => {
            hdrSelection.status = status;
            hdrStatusControl.updateDisplay();
        };
        /** Keep the active environment until its replacement is ready; latest selection wins. */
        const switchHdrEnvironment = async (url: string) => {
            const request = ++hdrRequest;
            if (disposed) return;
            if (url === activeHdrUrl) { setHdrStatus('Gotowe'); return; }
            setHdrStatus('Ładowanie…');
            let texture: THREE.DataTexture | undefined;
            let target: THREE.WebGLRenderTarget;
            try {
                texture = await new HDRLoader().loadAsync(url);
                if (disposed || request !== hdrRequest) { texture.dispose(); return; }
                texture.mapping = THREE.EquirectangularReflectionMapping;
                target = pmrem.fromEquirectangular(texture);
            } catch (error) {
                texture?.dispose();
                if (disposed || request !== hdrRequest) return;
                hdrSelection.file = activeHdrUrl;
                hdrFileControl.updateDisplay();
                setHdrStatus('Błąd ładowania — spróbuj ponownie');
                console.warn('Could not load HDR environment.', error);
                return;
            }
            const previousTexture = skyEnvironment;
            const previousTarget = environmentTarget;
            skyEnvironment = texture;
            environmentTarget = target;
            scene.background = skyEnvironment;
            scene.environment = environmentTarget.texture;
            activeHdrUrl = url;
            previousTexture.dispose();
            previousTarget.dispose();
            setHdrStatus('Gotowe');
            if (!running && !preparing) render();
        };
        hdrFileControl.onChange((url: string) => { void switchHdrEnvironment(url); });
        const updateHdrRotation = () => {
            if (disposed) return;
            scene.backgroundRotation.set(degrees(hdrRotation.x), degrees(hdrRotation.y), degrees(hdrRotation.z));
            scene.environmentRotation.copy(scene.backgroundRotation);
            // Idle scenes have no animation loop; sliders still need an immediate redraw.
            if (!running && !preparing) render();
        };
        const rotationControls = (['x', 'y', 'z'] as const).map(axis =>
            hdrFolder.add(hdrRotation, axis, -180, 180, 0.1)
                .name(`Obrót ${axis.toUpperCase()} (°)`)
                .onChange(updateHdrRotation),
        );
        hdrFolder.add({ reset: () => rotationControls.forEach(control => control.reset()) }, 'reset').name('Wyzeruj obrót');

        return {
            prepareReveal,
            prepareAllReveals,
            /** Choose the next playback's choreography; an in-flight reveal keeps its current mode. */
            setPresentationMode(mode: PresentationMode) {
                if (mode !== 'during' && mode !== 'after') return;
                animationSettings.mode = mode;
                modeControl.updateDisplay();
            },
            /** The app owns card readiness and the fetch/playback lock used by the GUI callback. */
            setReplayAvailable(available: boolean) {
                replayAvailable = available && Boolean(onReplay) && !disposed;
                replayControl.enable(replayAvailable);
            },
            /** Reset the scene, retaining warmed resources; hide the shell for the search screen. */
            showIdle({ ballVisible = true }: { ballVisible?: boolean } = {}) {
                if (disposed) return;
                cancelPlayback();
                resetBall();
                ballFlight.visible = ballVisible;
                phase = 'idle';
                effectFinished = false;
                playbackEpoch++; cardImageRequest++;
                playbackWanted = false; buffering = false; running = false;
                renderer.setAnimationLoop(null);
                timeline.pause(0, true); timeline.kill();
                for (const effect of [psychic, electric, grass, fire, water, ice, fighting, poison, ground,
                    flying, bug, rock, ghost, dragon, dark, steel, fairy, normal]) effect?.setActive(false);
                fogVolumes.forEach(volume => { volume.mesh.visible = false; volume.replay?.deactivate(); });
                mist = undefined; fogEffect = undefined;
                setDragonLook(false);
                glb.scene.rotation.set(0, 0, 0);
                lid.rotation.x = lidClosedX;
                frontMaterial.opacity = backMaterial.opacity = edgeMaterial.opacity = 0;
                card.visible = false;
                revealFill.intensity = 0;
                lastShownTime = 0;
                idle = true;
                render();
            },
            // Used by the development preview only; no debug handles in production.
            debug: import.meta.env.DEV ? {
                async seek(time: number) {
                    if (disposed || idle || !Number.isFinite(time)) return;
                    cancelPlayback();
                    const epoch = ++playbackEpoch;
                    playbackWanted = false; buffering = false; running = false; renderer.setAnimationLoop(null);
                    timeline.pause();
                    if (mist instanceof GpuSmokeMist && fogEffect) await mist.prepare(time);
                    if (disposed || epoch !== playbackEpoch) return;
                    restoreEffectParent();
                    openBall();
                    phase = 'reveal';
                    effectFinished = false;
                    timeline.pause(0, true);
                    presentation.progress = 0;
                    activeEffect.setActive(true);
                    activeEffect.reset();
                    timeline.time(THREE.MathUtils.clamp(time, 0, timeline.duration()), true);
                    if (time >= timeline.duration()) {
                        activeEffect.finish(); effectFinished = true;
                        if (playbackMode === 'after') {
                            phase = 'focus';
                            presentation.progress = THREE.MathUtils.clamp((time - timeline.duration()) / CARD_PRESENTATION.duration, 0, 1);
                        }
                    }
                    stopRender();
                },
                /** Resume the development preview, optionally in slow motion. */
                resume(rate = 1) {
                    if (disposed || idle || !Number.isFinite(rate) || rate <= 0 || timeline.time() >= timeline.duration()) return;
                    playbackWanted = true;
                    if (document.hidden || buffering) return;
                    timeline.timeScale(rate).play();
                    startRender();
                },
                snapshot() {
                    scene.updateMatrixWorld(true);
                    const bounds = new THREE.Box3();
                    ballMeshes.forEach(mesh => bounds.expandByObject(mesh));
                    const projected = new THREE.Box3();
                    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y])
                        for (const z of [bounds.min.z, bounds.max.z]) projected.expandByPoint(new THREE.Vector3(x, y, z).project(camera));
                    const cardBounds = new THREE.Box3();
                    for (const x of [-0.35, 0.35]) for (const y of [-0.5, 0.5]) for (const z of [-0.01, 0.01])
                        cardBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(card.matrixWorld).project(camera));
                    return {
                        phase, motionTime: motionTimeline?.time() ?? 0,
                        presentationMode: playbackMode, selectedPresentationMode: animationSettings.mode,
                        presentationProgress: presentation.progress,
                        cardBounds: { min: cardBounds.min.toArray(), max: cardBounds.max.toArray() },
                        ballMatrix: ballOffset.matrixWorld.toArray(), cardMatrix: card.matrixWorld.toArray(),
                        ballCenter: ballSpin.getWorldPosition(new THREE.Vector3()).toArray(),
                        ballScreenCenter: ballSpin.getWorldPosition(new THREE.Vector3()).project(camera).toArray(),
                        cameraMatrix: camera.matrixWorld.toArray(),
                        ballBounds: { min: projected.min.toArray(), max: projected.max.toArray() },
                        prepared: [...preparedReveals], preparationMs: { ...preparationMs }, preparationGpuMs: { ...preparationGpuMs }, cardCache: cardTextures.snapshot(), mobile,
                        time: timeline.time(), duration: timeline.duration(), running, disposed, buffering,
                        effect: idle ? 'idle' : activeEffect.root.name,
                        idle, ballVisible: ballFlight.visible, cardVisible: card.visible, lidAngle: lid.rotation.x - lidClosedX,
                        revealLight: revealFill.intensity,
                        memory: { ...renderer.info.memory }, contextLost: renderer.getContext().isContextLost(), calls: renderer.info.render.calls,
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
                        mist: mist ? { visible: mist.mesh.visible, kind: 'gpu', ...mist.getDebugInfo() } : undefined,
                    };
                },
                /** Triangle/box clearance in card-local space, used only by choreography QA. */
                cardIntersections() {
                    scene.updateMatrixWorld(true);
                    const inverseCard = card.matrixWorld.clone().invert();
                    const bounds = new THREE.Box3(new THREE.Vector3(-0.35, -0.5, -0.01), new THREE.Vector3(0.35, 0.5, 0.01));
                    const triangle = new THREE.Triangle();
                    return ballMeshes.filter(mesh => {
                        const transform = new THREE.Matrix4().multiplyMatrices(inverseCard, mesh.matrixWorld);
                        const vertices = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
                        for (let i = 0; i < (index?.count ?? vertices.count); i += 3) {
                            [triangle.a, triangle.b, triangle.c].forEach((point, corner) =>
                                point.fromBufferAttribute(vertices, index ? index.getX(i + corner) : i + corner).applyMatrix4(transform));
                            if (bounds.intersectsTriangle(triangle)) return true;
                        }
                        return false;
                    }).map(mesh => mesh.name);
                },
                setFlyingFeathers(visible: boolean) { flying?.setFeathersVisible(visible); render(); },
                setBlackBackground(enabled: boolean) { scene.background = enabled ? null : skyEnvironment; render(); },
                model: glb.scene,
                card,
                /** QA controls extend the real finite timeline; no production globals. */
                extendReveal(seconds: number) {
                    if (Number.isFinite(seconds) && seconds > 0 && phase === 'throw')
                        timeline.to({}, { duration: seconds });
                },
                mistSettings: () => mist?.settings,
                setMistDebugView(view: 'lighting' | 'density' | 'velocity') {
                    if (mist instanceof GpuSmokeMist) { mist.debugView = view; render(); }
                },
                setMistOptimization(mode: 'reference' | 'optimized') {
                    if (mist instanceof GpuSmokeMist) { mist.mode = mode; render(); }
                },
                mistPixels: () => mist instanceof GpuSmokeMist ? mist.readPixels(renderer) : undefined,
                setSmokeFrameTiming(enabled: boolean) { frameTimingEnabled = enabled; frameTimer.clear(); },
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
                resetSmokeTiming() { frameTimer.clear(); if (mist instanceof GpuSmokeMist) { mist.timer.clear(); mist.simulation?.timer.clear(); mist.replay?.clearTiming(); mist.occupancy.timer.clear(); } },
                /** Side view is for occlusion QA; normal playback retains the original camera. */
                sideView(enabled: boolean) {
                    if (enabled) { camera.position.set(3.0, 0.6, 2.0); camera.lookAt(0, 0.1, 0); }
                    else frameCamera();
                    render();
                },
            } : undefined,
            async setCardImage(image: string) {
                const request = ++cardImageRequest;
                const lease = await cardTextures.acquire(image);
                try {
                    if (disposed || request !== cardImageRequest) return false;
                    const texture = lease.texture;
                    texture.colorSpace = THREE.SRGBColorSpace;
                    renderer.initTexture(texture);
                    frontMaterial.map = texture;
                    cardTextures.pin(texture);
                    frontMaterial.needsUpdate = true;
                    if (!running && idle) render();
                    return true;
                } finally { lease.release(); }
            },
            async play(reveal: RevealType = 'psychic'): Promise<'completed' | 'cancelled'> {
                if (disposed) return 'cancelled';
                cancelPlayback();
                const epoch = ++playbackEpoch;
                playbackMode = animationSettings.mode;
                replayAvailable = false; replayControl.disable();
                ballFlight.visible = false;
                playbackWanted = false; buffering = false; running = false; renderer.setAnimationLoop(null);
                timeline.kill();
                await prepareReveal(reveal);
                if (disposed || epoch !== playbackEpoch) return 'cancelled';
                selectReveal(reveal);
                if (mist) { await mist.prepare(0); mist.reset(); }
                if (disposed || epoch !== playbackEpoch) return 'cancelled';
                lastShownTime = 0;
                const completion = new Promise<'completed' | 'cancelled'>(resolve => { resolvePlayback = resolve; });
                if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    // Every fog variant needs the final frame before a render can advance there.
                    if (mist) await mist.prepare(timeline.duration());
                    if (disposed || epoch !== playbackEpoch) return 'cancelled';
                    timeline.progress(1, true);
                    finishReveal();
                    motionTimeline?.pause();
                    presentation.progress = 1;
                    beginDrop();
                    motion.drop = 1; updateDrop();
                    ballFlight.visible = true;
                    completePlayback();
                } else {
                    playbackWanted = true;
                    startThrow();
                    if (document.hidden) visibility();
                }
                return completion;
            },
            stop() {
                if (disposed) return;
                playbackWanted = false; playbackEpoch++; buffering = false;
                cancelPlayback();
                stopRender();
            },
            dispose() {
                releaseClipPrefetch(); releaseTexturePrefetch();
                if (disposed) return;
                disposed = true;
                cancelPlayback();
                hdrRequest++;
                hdrGui.destroy();
                playbackWanted = false; playbackEpoch++;
                running = false;
                cardImageRequest++;
                timeline.kill();
                renderer.setAnimationLoop(null);
                window.removeEventListener('resize', resize);
                document.removeEventListener('visibilitychange', visibility);
                // Sprites share a Three.js quad; release it only when the whole scene is destroyed.
                const spriteGeometries = new Set<THREE.BufferGeometry>();
                glb.scene.traverse(object => {
                    if (object instanceof THREE.Sprite) spriteGeometries.add(object.geometry);
                    if (object instanceof THREE.InstancedMesh) object.dispose();
                });
                spriteGeometries.forEach(geometry => geometry.dispose());
                preparations.clear(); preparedReveals.clear();
                psychic.dispose();
                electric?.dispose();
                grass?.dispose();
                bug?.dispose();
                flying?.dispose();
                dragon?.dispose();
                fairy?.dispose();
                normal?.dispose();
                fire?.dispose();
                water?.dispose();
                ice?.dispose();
                fighting?.dispose();
                ground?.dispose();
                rock?.dispose();
                poison?.dispose();
                ghost?.dispose();
                dark?.dispose();
                steel?.dispose();
                fogVolumes.forEach(volume => volume.dispose());
                depthTarget?.dispose();
                depthMaterials.forEach(material => material.dispose());
                card.geometry.dispose();
                cardTextures.dispose();
                backTexture.dispose();
                frontMaterial.dispose();
                backMaterial.dispose();
                edgeMaterial.dispose();
                scene.background = null;
                scene.environment = null;
                skyEnvironment.dispose();
                environmentTarget.dispose();
                pmrem.dispose();
                setDragonLook(false);
                originalBallLook.forEach(look => { look.dragon.dispose(); look.dark.dispose(); look.fairy.dispose(); look.normal.dispose(); });
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
