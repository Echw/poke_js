import './style.css'
import { sceneController } from './scene/scene';
import { fetchCard } from './data/tcgdex';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvas) {
    throw new Error('Canvas not found');
}

const scene = await sceneController.initScene(canvas);


const card = await fetchCard();
if (!card) {
    throw new Error('Card not found');
}
await scene.setCardImage(card);
console.log(card);




