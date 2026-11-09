import { pokemonTypeData } from './pokemonTypeData.ts';
import type { CardSelection } from './tcgdex';
import type { RevealType } from '../effects/types';
const supported = new Set<string>(['psychic', 'electric', 'grass', 'fire', 'water', 'ice', 'fighting', 'poison', 'ground', 'flying', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy', 'normal']);
const normalize = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '').replace(/♀/g, ' f ').replace(/♂/g, ' m ').replace(/[^a-z0-9]+/g, ' ').trim();
const entries = pokemonTypeData.map(([dex, name, species, types, base]) => ({ dex, name: normalize(name), species: normalize(species), types, base }));
const byDex = new Map<number, typeof entries>();
for (const entry of entries) {
    const list = byDex.get(entry.dex) || [];
    list.push(entry);
    byDex.set(entry.dex, list);
}
/** Preserve actual game type slots; TCG energy is only used by the caller's legacy fallback. */
export function speciesRevealType(card: CardSelection): RevealType | undefined {
    const name = normalize(card.name.replace(/^.*?[’']s\s+/i, ''))
        .replace(/\balolan\b/g, 'alola').replace(/\bgalarian\b/g, 'galar')
        .replace(/\bhisuian\b/g, 'hisui').replace(/\bpaldean\b/g, 'paldea')
        .replace(/^m\s+/, 'mega ').replace(/\b(?:forme|form)\b/g, '')
        .replace(/\s+(?:ex|gx|v|vmax|vstar|lv\s*x|break|delta species)\b.*$/, '').trim();
    const words = new Set(name.split(/\s+/));
    if (words.has('tauros') && words.has('paldea')) {
        words.add('breed');
        if (!words.has('blaze') && !words.has('aqua'))
            words.add('combat');
    }
    const firstDex = card.dexId.find(id => byDex.has(id));
    const candidates = firstDex !== undefined ? byDex.get(firstDex)! : entries.filter(entry => entry.species.split(' ').every(word => words.has(word)));
    if (!candidates.length)
        return undefined;
    // Alternate-form qualifiers must be explicit; never infer a form from TCG energy.
    const forms = candidates.filter(entry => !entry.base && entry.name.split(' ').every(word => word === 'standard' || words.has(word)));
    forms.sort((a, b) => b.name.length - a.name.length);
    const selected = forms[0] || candidates.find(entry => entry.base);
    // Preserve existing secondary-type reveals (Pidgeotto -> Flying, not Normal).
    return (selected?.types.find(type => type !== 'normal' && supported.has(type))
        ?? selected?.types.find(type => supported.has(type))) as RevealType | undefined;
}
