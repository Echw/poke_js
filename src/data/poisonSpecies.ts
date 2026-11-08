import type { CardSelection } from './tcgdex';

// Verified against https://pokeapi.co/api/v2/type/poison on 2026-11-08: slot === 1 only.
// TCG energy is deliberately not used: Poison has appeared under multiple energies.
const PRIMARY_POISON_SPECIES = new Set([
    23, 24, 29, 30, 31, 32, 33, 34, 41, 42, 88, 89, 109, 110, 169, 316, 317, 336,
    434, 435, 451, 452, 453, 454, 568, 569, 690, 691, 747, 748, 757, 758, 803, 804,
    890, 944, 945, 980, 1014, 1015, 1016, 1025,
]);
const PRIMARY_POISON_NAMES = new Set([
    'ekans', 'arbok', 'nidoran f', 'nidorina', 'nidoqueen', 'nidoran m', 'nidorino',
    'nidoking', 'zubat', 'golbat', 'grimer', 'muk', 'koffing', 'weezing', 'crobat',
    'gulpin', 'swalot', 'seviper', 'stunky', 'skuntank', 'skorupi', 'drapion',
    'croagunk', 'toxicroak', 'trubbish', 'garbodor', 'skrelp', 'dragalge', 'mareanie',
    'toxapex', 'salandit', 'salazzle', 'poipole', 'naganadel', 'eternatus', 'shroodle',
    'grafaiai', 'clodsire', 'okidogi', 'munkidori', 'fezandipiti', 'pecharunt',
]);
const REGIONAL_PRIMARY_POISON: Record<number, RegExp> = {
    80: /\b(galarian|galar)\b/, 199: /\b(galarian|galar)\b/,
    194: /\b(paldean|paldea)\b/,
};

/** Only primary Poison overrides TCG energy; secondary Poison retains the existing resolver. */
export function isPoisonCard(card: CardSelection): boolean {
    const name = card.name.toLowerCase().replace(/[’']/g, "'").replace(/-/g, ' ');
    if (card.dexId.some(id => REGIONAL_PRIMARY_POISON[id]?.test(name) || PRIMARY_POISON_SPECIES.has(id))) return true;
    if (/\b(?:(?:galarian|galar) (?:slowbro|slowking)|(?:slowbro|slowking) galar|(?:paldean|paldea) wooper|wooper paldea)\b/.test(name)) return true;
    const species = name.replace(/^(?:.*?'s\s+|dark\s+|light\s+|radiant\s+|mega\s+|m\s+|alolan\s+|galarian\s+|hisuian\s+)+/, '')
        .replace(/\s+(?:ex|gx|v|vmax|vstar|lv\.?\s*x|break|radiant|delta species).*$/, '').trim();
    return PRIMARY_POISON_NAMES.has(species) || /^nidoran\s*[♀♂fm]?$/.test(species);
}
