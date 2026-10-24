export async function fetchCard() {
    try {
        const response = await fetch('https://api.tcgdex.net/v2/en/cards/base1-43');
        console.log(response.status, response.ok);

        if (!response.ok) {
            console.error(response.status)
            return;

        }

        const data: unknown = await response.json();

        if (data === null || typeof data !== 'object') {
            return;
        }

        if (!('image' in data) || typeof data.image !== 'string') {
            return;
        }

        return `${data.image}/high.webp`;


    } catch (e) {
        console.error('Could not load card:', e)
    }
}


