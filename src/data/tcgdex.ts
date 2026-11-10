type CardBrief = { id: string; name: string; image: string };
export type CardSelection = { image: string; types: string[]; name: string; dexId: number[] };
type CardDetail = { image: string; types?: string[]; name: string; dexId?: number[] };

function isCardBrief(value: unknown): value is CardBrief {
    return value !== null && typeof value === 'object'
        && 'id' in value && typeof value.id === 'string'
        && 'name' in value && typeof value.name === 'string'
        && 'image' in value && typeof value.image === 'string';
}

function isCardDetail(value: unknown): value is CardDetail {
    return value !== null && typeof value === 'object'
        && 'name' in value && typeof value.name === 'string'
        && (!('dexId' in value) || (Array.isArray(value.dexId) && value.dexId.every(id => typeof id === 'number')))
        && 'image' in value && typeof value.image === 'string'
        && (!('types' in value) || (Array.isArray(value.types) && value.types.every((type) => typeof type === 'string')));
}

const selections = new Map<string, { card: CardSelection; expires: number }>();
const pendingSelections = new Map<string, Promise<CardSelection | undefined>>();

/** Cache successful queries for 30 minutes; failed/empty responses remain retryable. */
export async function fetchCard(name?: string): Promise<CardSelection | undefined> {
    const key = name?.trim().toLowerCase() || '__initial_abra__';
    const cached = selections.get(key);
    if (cached && cached.expires > Date.now()) {
        selections.delete(key); selections.set(key, cached);
        return cached.card;
    }
    selections.delete(key);
    const pending = pendingSelections.get(key);
    if (pending) return pending;
    const started = performance.now();
    const request = fetchUncachedCard(name).then(card => {
        if (card) {
            selections.set(key, { card, expires: Date.now() + 30 * 60 * 1000 });
            while (selections.size > 50) selections.delete(selections.keys().next().value!);
        }
        return card;
    });
    pendingSelections.set(key, request);
    try { return await request; }
    finally {
        pendingSelections.delete(key);
        performance.measure('pokemon:api', { start: started, end: performance.now() });
    }
}

async function fetchUncachedCard(name?: string): Promise<CardSelection | undefined> {
    const query = name?.trim();

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    try {
        const url = query
            ? `https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(query)}`
            : 'https://api.tcgdex.net/v2/en/cards/base1-43';
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`TCGdex returned ${response.status}`);
        const data: unknown = await response.json();
        let detail: unknown = data;
        if (query && Array.isArray(data)) {
            const results = data.filter(isCardBrief);
            const card = results.find((item) => item.name.toLowerCase() === query.toLowerCase()) ?? results[0];
            if (!card) return undefined;
            const detailResponse = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(card.id)}`, { signal: controller.signal });
            if (!detailResponse.ok) throw new Error(`TCGdex returned ${detailResponse.status}`);
            detail = await detailResponse.json();
        }
        if (!isCardDetail(detail)) return undefined;
        return { image: detail.image, types: detail.types ?? [], name: detail.name, dexId: detail.dexId ?? [] };
    } finally {
        window.clearTimeout(timeout);
    }
}
