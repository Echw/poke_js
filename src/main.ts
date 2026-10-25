import './styles/main.scss'
import { sceneController } from './scene/scene';
import { fetchCard } from './data/tcgdex';

type Scene = Awaited<ReturnType<typeof sceneController.initScene>>;

async function loadCardImage(scene: Scene, imageBase: string, isCurrent: () => boolean): Promise<boolean> {
    if (!isCurrent()) return false;
    try {
        return await scene.setCardImage(`${imageBase}/high.webp`);
    } catch (error) {
        if (!isCurrent()) return false;
        console.warn('High quality card image failed; trying low quality.', error);
        return scene.setCardImage(`${imageBase}/low.webp`);
    }
}

async function start() {
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
    const searchForm = document.querySelector<HTMLFormElement>('#pokemon-search');
    const searchInput = document.querySelector<HTMLInputElement>('#pokemon-name');
    const status = document.querySelector<HTMLOutputElement>('#summon-status');
    if (!canvas || !searchForm || !searchInput || !status) throw new Error('Page elements not found');
    const submitButton = searchForm.querySelector<HTMLButtonElement>('button');
    if (!submitButton) throw new Error('Summon button not found');

    let cardRequestId = 0;
    const initialCard = fetchCard().catch((error) => {
        console.error('Could not fetch Abra.', error);
        return undefined;
    });

    try {
        const scene = await sceneController.initScene(canvas);
        scene.play();
        submitButton.disabled = false;
        status.textContent = 'Loading Abra…';

        void (async () => {
            const imageBase = await initialCard;
            if (cardRequestId !== 0) return;
            if (!imageBase) {
                status.textContent = 'Could not load Abra. Search to try again.';
                return;
            }
            try {
                const applied = await loadCardImage(scene, imageBase, () => cardRequestId === 0);
                if (cardRequestId === 0 && applied) status.textContent = '';
            } catch (error) {
                console.error('Could not load Abra image.', error);
                if (cardRequestId === 0) status.textContent = 'Could not load Abra. Search to try again.';
            }
        })();

        searchForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const requestId = ++cardRequestId;
            const isCurrent = () => requestId === cardRequestId;
            const name = searchInput.value.trim();
            submitButton.disabled = true;
            status.textContent = 'Finding card…';
            try {
                const imageBase = await fetchCard(name);
                if (!isCurrent()) return;
                if (!imageBase) {
                    status.textContent = `No card found for ${name}.`;
                    return;
                }
                const applied = await loadCardImage(scene, imageBase, isCurrent);
                if (!isCurrent() || !applied) return;
                status.textContent = '';
                scene.play();
            } catch (error) {
                console.error('Could not load card.', error);
                if (isCurrent()) status.textContent = 'Could not load that card. Please try again.';
            } finally {
                submitButton.disabled = false;
            }
        });
    } catch (error) {
        console.error('Could not prepare scene.', error);
        status.textContent = 'Could not load the scene. Please retry.';
        submitButton.type = 'button';
        submitButton.textContent = 'Retry';
        submitButton.disabled = false;
        submitButton.addEventListener('click', () => window.location.reload());
    }
}

void start();

