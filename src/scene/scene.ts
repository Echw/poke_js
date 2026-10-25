import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import gsap from 'gsap';

import pokeballUrl from '../assets/pokeball.glb?url';
import skyEnvironmentUrl from '../assets/sky/NightSkyHDRI006_4K_HDR.exr?url';
import { PsychicEffect } from '../effects/psychic';
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
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;

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
        const psychicFill = new THREE.PointLight(0xe879f9, 0, 3.0);
        psychicFill.position.set(0, 0.3, 0.25);
        scene.add(psychicFill);

        scene.add(glb.scene);

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

        const psychic = new PsychicEffect(card, window.innerWidth < 700);
        psychic.root.traverse((object) => { object.renderOrder = 2; });
        glb.scene.add(psychic.root);

        let disposed = false;
        let cardImageRequest = 0;
        let running = false;
        const render = () => {
            psychic.update(timeline.time(), window.innerHeight * renderer.getPixelRatio());
            psychicFill.intensity = psychic.state.burst * psychic.state.fade * 3.0;
            renderer.render(scene, camera);
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
            psychic.finish();
            stopRender();
        };

        const timeline = gsap.timeline({ paused: true, onStart: startRender, onComplete: finishRender });
        timeline.to(lid.rotation, { x: lidClosedX - degrees(45), duration: 1.90, ease: 'power1.out' }, 0);
        timeline.to(glb.scene.rotation, { x: degrees(4), duration: 1.90, ease: 'power1.out' }, 0);
        psychic.addToTimeline(timeline);
        timeline.to(card.position, { y: 0.40, z: 0.50, duration: 0.70, ease: 'power2.out' }, 1.45);
        timeline.to(card.rotation, { x: degrees(-4), y: 0, z: 0, duration: 2.15, ease: 'power1.out' }, 1.35);
        timeline.to(card.scale, { x: 1.18, y: 1.18, z: 1.18, duration: 0.70, ease: 'power2.out' }, 1.45);
        timeline.to([frontMaterial, backMaterial, edgeMaterial], { opacity: 1, duration: 0.70, ease: 'power2.inOut' }, 2.15);

        const resize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            frameCamera();
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            renderer.setSize(window.innerWidth, window.innerHeight);
            if (!running) render();
        };
        window.addEventListener('resize', resize);
        render();

        return {
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
            play() {
                if (disposed) return;
                timeline.pause(0);
                psychic.reset();
                glb.scene.rotation.set(0, 0, 0);
                lid.rotation.x = lidClosedX;
                card.position.set(0, 0.03, 0.26);
                card.rotation.set(0, degrees(-70), degrees(-8));
                card.scale.setScalar(0.26);
                frontMaterial.opacity = backMaterial.opacity = edgeMaterial.opacity = 0;
                if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
                    timeline.progress(1);
                    finishRender();
                } else {
                    timeline.play(0);
                }
            },
            stop() {
                timeline.pause();
                stopRender();
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                cardImageRequest++;
                timeline.kill();
                renderer.setAnimationLoop(null);
                window.removeEventListener('resize', resize);
                psychic.dispose();
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
            },
        };
    },
};
