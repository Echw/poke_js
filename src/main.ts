import './styles/main.scss';
import { sceneController } from './scene/scene';
import { fetchCard } from './data/tcgdex';
import { revealTypeForCard } from './data/revealType';

type Scene = Awaited<ReturnType<typeof sceneController.initScene>>;

async function loadCardImage(scene: Scene, imageBase: string, isCurrent: () => boolean): Promise<boolean> {
    if (!isCurrent()) return false;
    if (imageBase.startsWith('/textures/')) return scene.setCardImage(imageBase);
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
    const previewReveal = (['psychic', 'electric', 'grass', 'fire', 'water', 'ice', 'fighting', 'poison', 'ground', 'flying', 'bug', 'rock', 'ghost'] as const).find(
              (type) => type === requestedReveal,
          );
    const initialName = previewReveal === 'ghost' ? 'Gastly' : previewReveal === 'rock' ? 'Geodude' : previewReveal === 'bug' ? 'Caterpie' : previewReveal === 'flying' ? 'Pidgeotto' : previewReveal === 'ground' ? 'Sandshrew' : previewReveal === 'poison' ? 'Koffing' : previewReveal === 'fighting' ? 'Machop' : previewReveal === 'ice' ? 'Glaceon' : previewReveal === 'water' ? 'Squirtle' : 'Abra';
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
    const searchForm = document.querySelector<HTMLFormElement>('#pokemon-search');
    const searchInput = document.querySelector<HTMLInputElement>('#pokemon-name');
    const status = document.querySelector<HTMLOutputElement>('#summon-status');
    if (!canvas || !searchForm || !searchInput || !status) throw new Error('Page elements not found');
    const submitButton = searchForm.querySelector<HTMLButtonElement>('button');
    if (!submitButton) throw new Error('Summon button not found');

    let cardRequestId = 0;
    const initialCard = (
        previewReveal === 'ghost'
            ? Promise.resolve({ name: 'Gastly', image: '/textures/gastly-preview.webp', types: ['Psychic'], dexId: [92] })
            : previewReveal === 'rock'
            ? Promise.resolve({ name: 'Geodude', image: '/textures/geodude-preview.webp', types: ['Fighting'], dexId: [74] })
            : previewReveal === 'bug'
            ? Promise.resolve({ name: 'Caterpie', image: '/textures/caterpie-preview.webp', types: ['Grass'], dexId: [10] })
            : previewReveal === 'flying'
            ? Promise.resolve({ name: 'Pidgeotto', image: 'https://assets.tcgdex.net/en/base/base1/22', types: ['Colorless'], dexId: [17] })
            : previewReveal === 'ground'
            ? Promise.resolve({ name: 'Sandshrew', image: 'https://assets.tcgdex.net/en/base/base1/62', types: ['Fighting'], dexId: [27] })
            : previewReveal === 'poison'
            ? Promise.resolve({ name: 'Koffing', image: 'https://assets.tcgdex.net/en/base/base1/51', types: ['Grass'], dexId: [109] })
            : previewReveal === 'ice'
            ? Promise.resolve({
                  name: 'Glaceon',
                  image: 'https://assets.tcgdex.net/en/dp/dp5/5',
                  types: ['Water'],
                  dexId: [471],
              })
            : previewReveal === 'fighting'
              ? Promise.resolve({ name: 'Machop', image: 'https://assets.tcgdex.net/en/base/base1/52', types: ['Fighting'], dexId: [66] })
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
                    previewReveal === 'flying' || previewReveal === 'ice' || previewReveal === 'fighting' || previewReveal === 'ground' || previewReveal === 'poison'
                        ? await scene.setCardImage(previewReveal === 'flying' ? '/textures/pidgeotto-preview.webp' : previewReveal === 'ground' ? '/textures/sandshrew-preview.webp' : previewReveal === 'poison' ? '/textures/koffing-preview.webp' : previewReveal === 'ice' ? '/textures/glaceon-preview.webp' : '/textures/machop-preview.webp')
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

