import * as THREE from 'three';


export const sceneController = {
    initScene(canvas: HTMLCanvasElement) {
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 0, 5);
        camera.aspect = canvas.clientWidth / canvas.clientHeight;
        camera.updateProjectionMatrix();
        const renderer = new THREE.WebGLRenderer({ canvas })
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const cube = new THREE.Mesh(geometry, material);
        scene.add(cube);
        renderer.render(scene, camera);
    }
}

