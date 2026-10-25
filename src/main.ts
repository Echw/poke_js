import './styles/main.scss'
import { sceneController } from './scene/scene';
import { fetchCard } from './data/tcgdex';

const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
if (!canvas) {
    throw new Error('Canvas not found');
}

const scene = await sceneController.initScene(canvas);
try {
    const card = await fetchCard();
    await scene.setCardImage(card ?? '/textures/artwork_back.webp');
} catch {
    await scene.setCardImage('/textures/artwork_back.webp');
}
scene.play();

const searchForm = document.querySelector<HTMLFormElement>('#pokemon-search');
const searchInput = document.querySelector<HTMLInputElement>('#pokemon-name');
const status = document.querySelector<HTMLOutputElement>('#summon-status');
if (!searchForm || !searchInput || !status) throw new Error('Summon form not found');
const submitButton = searchForm.querySelector<HTMLButtonElement>('button');
if (!submitButton) throw new Error('Summon button not found');
submitButton.disabled = false;
status.textContent = '';

searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = searchInput.value.trim();
    submitButton.disabled = true;
    status.textContent = 'Finding card…';
    try {
        const image = await fetchCard(name);
        if (!image) {
            status.textContent = `No card found for ${name}.`;
            return;
        }
        await scene.setCardImage(image);
        status.textContent = '';
        scene.play();
    } catch {
        status.textContent = 'Could not load that card. Please try again.';
    } finally {
        submitButton.disabled = false;
    }
});

