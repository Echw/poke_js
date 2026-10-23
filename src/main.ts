import './style.css'
import { sceneController } from './scene/scene';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvas) {
    throw new Error('Canvas not found');
}

sceneController.initScene(canvas);

