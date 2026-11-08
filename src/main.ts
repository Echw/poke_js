import './styles/main.scss';
import { sceneController } from './scene/scene';
import { fetchCard } from './data/tcgdex';
import { revealTypeForCard } from './data/revealType';

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
    const previewParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : undefined;
    const requestedReveal = previewParams?.get('reveal');
    const previewReveal = (['psychic', 'electric', 'grass', 'fire', 'water', 'ice'] as const).find(
              (type) => type === requestedReveal,
          );
    const initialName = previewReveal === 'ice' ? 'Glaceon' : previewReveal === 'water' ? 'Squirtle' : 'Abra';
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
    const searchForm = document.querySelector<HTMLFormElement>('#pokemon-search');
    const searchInput = document.querySelector<HTMLInputElement>('#pokemon-name');
    const status = document.querySelector<HTMLOutputElement>('#summon-status');
    if (!canvas || !searchForm || !searchInput || !status) throw new Error('Page elements not found');
    const submitButton = searchForm.querySelector<HTMLButtonElement>('button');
    if (!submitButton) throw new Error('Summon button not found');

    let cardRequestId = 0;
    const initialCard = (
        previewReveal === 'ice'
            ? Promise.resolve({
                  name: 'Glaceon',
                  image: 'https://assets.tcgdex.net/en/dp/dp5/5',
                  types: ['Water'],
                  dexId: [471],
              })
            : fetchCard(previewReveal === 'water' ? 'Squirtle' : undefined)
    ).catch((error) => {
        console.error(`Could not fetch ${initialName}.`, error);
        return undefined;
    });

    try {
        const scene = await sceneController.initScene(canvas);
        status.textContent = 'Przygotowywanie animacji…';
        await scene.play(previewReveal);
        if (import.meta.env.DEV) {
            Object.assign(window, { __pokemonReveal: scene });
        }
        submitButton.disabled = false;
        status.textContent = `Loading ${initialName}…`;

        void (async () => {
            const selectedCard = await initialCard;
            if (cardRequestId !== 0) return;
            if (!selectedCard) {
                status.textContent = `Could not load ${initialName}. Search to try again.`;
                return;
            }
            try {
                const applied =
                    previewReveal === 'ice'
                        ? await scene.setCardImage('/textures/glaceon-preview.webp')
                        : await loadCardImage(scene, selectedCard.image, () => cardRequestId === 0);
                if (cardRequestId === 0 && applied) status.textContent = '';
            } catch (error) {
                console.error(`Could not load ${initialName} image.`, error);
                if (cardRequestId === 0)
                    status.textContent = `Could not load ${initialName}. Search to try again.`;
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
                const selectedCard = await fetchCard(name);
                if (!isCurrent()) return;
                if (!selectedCard) {
                    status.textContent = `No card found for ${name}.`;
                    return;
                }
                const applied = await loadCardImage(scene, selectedCard.image, isCurrent);
                if (!isCurrent() || !applied) return;
                status.textContent = 'Przygotowywanie animacji…';
                await scene.play(revealTypeForCard(selectedCard));
                if (isCurrent()) status.textContent = '';
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

