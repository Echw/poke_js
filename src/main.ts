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
    const previewReveal = (['psychic', 'electric', 'grass', 'fire', 'water', 'ice', 'fighting', 'poison', 'ground', 'flying', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy', 'normal'] as const).find(
              (type) => type === requestedReveal,
          );
    const initialName = previewReveal === 'normal' ? 'Eevee' : previewReveal === 'fairy' ? 'Sylveon' : previewReveal === 'steel' ? 'Metagross' : previewReveal === 'dark' ? 'Umbreon' : previewReveal === 'dragon' ? 'Dragonair' : previewReveal === 'ghost' ? 'Gastly' : previewReveal === 'rock' ? 'Geodude' : previewReveal === 'bug' ? 'Caterpie' : previewReveal === 'flying' ? 'Pidgeotto' : previewReveal === 'ground' ? 'Sandshrew' : previewReveal === 'poison' ? 'Koffing' : previewReveal === 'fighting' ? 'Machop' : previewReveal === 'ice' ? 'Glaceon' : previewReveal === 'water' ? 'Squirtle' : 'Abra';
    const canvas = document.querySelector<HTMLCanvasElement>('#canvas');
    const searchForm = document.querySelector<HTMLFormElement>('#pokemon-search');
    const searchInput = document.querySelector<HTMLInputElement>('#pokemon-name');
    const status = document.querySelector<HTMLOutputElement>('#summon-status');
    if (!canvas || !searchForm || !searchInput || !status) throw new Error('Page elements not found');
    const submitButton = searchForm.querySelector<HTMLButtonElement>('button');
    if (!submitButton) throw new Error('Summon button not found');

    let cardRequestId = 0;
    const initialCard = (
        !previewReveal
            ? Promise.resolve(undefined)
            : previewReveal === 'normal'
            ? Promise.resolve({ name: 'Eevee', image: '/textures/eevee-preview.webp', types: ['Colorless'], dexId: [133] })
            : previewReveal === 'fairy'
            ? Promise.resolve({ name: 'Sylveon', image: '/textures/sylveon-preview.webp', types: ['Fairy'], dexId: [700] })
            : previewReveal === 'steel'
            ? Promise.resolve({ name: 'Metagross', image: '/textures/metagross-preview.webp', types: ['Metal'], dexId: [376] })
            : previewReveal === 'dark'
            ? Promise.resolve({ name: 'Umbreon', image: '/textures/umbreon-preview.webp', types: ['Darkness'], dexId: [197] })
            : previewReveal === 'dragon'
            ? Promise.resolve({ name: 'Dragonair', image: '/textures/dragonair-preview.webp', types: ['Colorless'], dexId: [148] })
            : previewReveal === 'ghost'
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


    const loader = document.querySelector<HTMLElement>('#startup-loader')!;
    const loaderMessage = document.querySelector<HTMLElement>('#startup-message')!;
    const progress = document.querySelector<HTMLProgressElement>('#startup-progress')!;
    const retry = document.querySelector<HTMLButtonElement>('#startup-retry')!;
    let scene: Scene | undefined;
    let initializing = false;
    let ready = false;
    let destroyed = false;
    let searching = false;

    const initialize = async () => {
        if (initializing || ready || destroyed) return;
        initializing = true;
        retry.hidden = true;
        loaderMessage.textContent = scene ? 'Przygotowywanie animacji…' : 'Pobieranie zasobów…';
        try {
            scene ??= await sceneController.initScene(canvas);
            if (destroyed) { scene.dispose(); return; }
            await scene.prepareAllReveals(({ completed, total }) => {
                progress.max = total;
                progress.value = completed;
                loaderMessage.textContent = `Przygotowywanie animacji ${completed}/${total}`;
            });
            if (destroyed) return;
            if (import.meta.env.DEV) Object.assign(window, { __pokemonReveal: scene });
            const selectedCard = await initialCard;
            let imageReady = false;
            if (selectedCard) {
                try {
                    const localPreview = previewReveal === 'flying' ? 'pidgeotto'
                        : previewReveal === 'ground' ? 'sandshrew' : previewReveal === 'poison' ? 'koffing'
                        : previewReveal === 'ice' ? 'glaceon' : previewReveal === 'fighting' ? 'machop' : undefined;
                    imageReady = await loadCardImage(scene, localPreview ? `/textures/${localPreview}-preview.webp` : selectedCard.image, () => !destroyed);
                } catch (error) { console.warn('Could not load initial card image.', error); }
            }
            if (destroyed) return;
            if (!imageReady) scene.showIdle();
            if (destroyed) return;
            loaderMessage.textContent = 'Gotowe';
            ready = true;
            searchForm.inert = false;
            searchForm.setAttribute('aria-busy', 'false');
            submitButton.disabled = false;
            status.textContent = !previewReveal || imageReady ? '' : `Could not load ${initialName}. Search to try again.`;
            loader.hidden = !(imageReady && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
            if (imageReady) {
                searching = true;
                submitButton.disabled = true;
                try { await scene.play(previewReveal); }
                finally {
                    searching = false;
                    if (!destroyed) { submitButton.disabled = false; loader.hidden = true; }
                }
            }
        } catch (error) {
            console.error('Could not prepare scene.', error);
            loaderMessage.textContent = 'Nie udało się przygotować animacji. Spróbuj ponownie.';
            retry.hidden = false;
        } finally { initializing = false; }
    };
    retry.addEventListener('click', () => { void initialize(); });

    searchForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!ready || !scene || destroyed || searching) return;
        const name = searchInput.value.trim();
        if (!name) return;
        const requestId = ++cardRequestId;
        const isCurrent = () => !destroyed && requestId === cardRequestId;
        searching = true;
        submitButton.disabled = true;
        status.textContent = 'Finding card…';
        try {
            const selectedCard = await fetchCard(name);
            if (!isCurrent()) return;
            if (!selectedCard) { status.textContent = `No card found for ${name}.`; return; }
            const started = performance.now();
            const applied = await loadCardImage(scene, selectedCard.image, isCurrent);
            performance.measure('pokemon:card-image', { start: started, end: performance.now() });
            if (!isCurrent() || !applied) return;
            status.textContent = '';
            await scene.play(revealTypeForCard(selectedCard));
            if (isCurrent()) status.textContent = '';
        } catch (error) {
            console.error('Could not load card.', error);
            if (isCurrent()) status.textContent = 'Could not load that card. Please try again.';
        } finally {
            if (isCurrent()) { searching = false; submitButton.disabled = false; }
        }
    });
    window.addEventListener('pagehide', event => {
        if (event.persisted) return;
        destroyed = true; cardRequestId++; scene?.dispose();
    });
    await initialize();
}

void start();

