import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import pokeballUrl from '../assets/pokeball.glb?url';
import gsap from 'gsap';


export const sceneController = {
    async initScene(canvas: HTMLCanvasElement) {
        const scene = new THREE.Scene();

        const sizes = {
            width: window.innerWidth,
            height: window.innerHeight,
        };


        const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 1000);
        camera.position.set(0, 0, 3);
        camera.updateProjectionMatrix();

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(1, 1, 3);
        scene.add(directionalLight);

        const renderer = new THREE.WebGLRenderer({ canvas })
        renderer.setSize(sizes.width, sizes.height);

        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('/draco/');
        loader.setDRACOLoader(dracoLoader);
        const glb = await loader.loadAsync(pokeballUrl);
        scene.add(glb.scene);

        const lid = glb.scene.getObjectByName("button_low001")
        console.log(lid)

        if (lid) {
            gsap.to(lid.rotation, {
                x: -Math.PI / 4, ease: "power2.out", duration: 2, delay: 2,
                onUpdate: () => renderer.render(scene, camera)
            })
        }


        window.addEventListener("resize", () => {
            // Update sizes
            sizes.width = window.innerWidth;
            sizes.height = window.innerHeight;

            // Update camera
            camera.aspect = sizes.width / sizes.height;
            camera.updateProjectionMatrix();

            // Update renderer
            renderer.setSize(sizes.width, sizes.height);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

            renderer.render(scene, camera);
        });


        renderer.render(scene, camera);
    }


}

