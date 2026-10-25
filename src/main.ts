import './styles/main.scss'
import { sceneController } from './scene/scene';
import { fetchCard } from './data/tcgdex';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvas) {
    throw new Error('Canvas not found');
}

const searchForm = document.querySelector<HTMLFormElement>('#pokemon-search');
if (!searchForm) {
    throw new Error('Search form not found');
}
searchForm.addEventListener('submit', (event) => event.preventDefault());

const scene = await sceneController.initScene(canvas);


const card = await fetchCard();
if (!card) {
    throw new Error('Card not found');
}
await scene.setCardImage(card);
console.log(card);




