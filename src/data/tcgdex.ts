type CardBrief = { name: string; image: string };

function isCardBrief(value: unknown): value is CardBrief {
    return value !== null && typeof value === 'object'
        && 'name' in value && typeof value.name === 'string'
        && 'image' in value && typeof value.image === 'string';
}

/** Returns a TCGdex card image; the initial reveal uses the classic Abra card. */
export async function fetchCard(name?: string): Promise<string | undefined> {
    const query = name?.trim();
    const url = query
        ? `https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(query)}`
        : 'https://api.tcgdex.net/v2/en/cards/base1-43';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`TCGdex returned ${response.status}`);
    const data: unknown = await response.json();
    if (query && Array.isArray(data)) {
        const results = data.filter(isCardBrief);
        const card = results.find((item) => item.name.toLowerCase() === query.toLowerCase()) ?? results[0];
        return card ? `${card.image}/high.webp` : undefined;
    }
    return isCardBrief(data) ? `${data.image}/high.webp` : undefined;
}
