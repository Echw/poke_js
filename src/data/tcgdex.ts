type CardBrief = { name: string; image: string };

function isCardBrief(value: unknown): value is CardBrief {
    return value !== null && typeof value === 'object'
        && 'name' in value && typeof value.name === 'string'
        && 'image' in value && typeof value.image === 'string';
}

export async function fetchCard(name?: string): Promise<string | undefined> {
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
        if (query && Array.isArray(data)) {
            const results = data.filter(isCardBrief);
            const card = results.find((item) => item.name.toLowerCase() === query.toLowerCase()) ?? results[0];
            return card?.image;
        }
        return isCardBrief(data) ? data.image : undefined;
    } finally {
        window.clearTimeout(timeout);
    }
}
