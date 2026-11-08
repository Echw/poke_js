import type { CardSelection } from './tcgdex';

// Verified 2026-11-08 against https://pokeapi.co/api/v2/type/ground, slot === 1.
const PRIMARY_GROUND = new Set([27,28,50,51,104,105,111,112,207,231,232,328,329,330,343,344,383,449,450,464,472,529,530,551,552,553,618,622,623,645,749,750,843,844,867,901,948,949,984,990]);
const NAMES = new Set('sandshrew,sandslash,diglett,dugtrio,cubone,marowak,rhyhorn,rhydon,gligar,phanpy,donphan,trapinch,vibrava,flygon,baltoy,claydol,groudon,hippopotas,hippowdon,rhyperior,gliscor,drilbur,excadrill,sandile,krokorok,krookodile,stunfisk,golett,golurk,landorus,mudbray,mudsdale,silicobra,sandaconda,runerigus,ursaluna,toedscool,toedscruel,great tusk,iron treads'.split(','));

/** Regional exclusions precede base-species IDs; TCG Fighting energy is not Ground. */
export function isGroundCard(card: CardSelection): boolean {
    const name = card.name.toLowerCase().replace(/[’']/g, "'").replace(/-/g, ' ');
    if (/\b(alolan|alola)\b/.test(name) && (card.dexId.some(id => [27,28,105].includes(id)) || /\b(sandshrew|sandslash|marowak)\b/.test(name))) return false;
    if (/\b(galarian|galar)\b/.test(name) && (card.dexId.includes(562) || /\byamask\b/.test(name))) return true;
    if (card.dexId.some(id => PRIMARY_GROUND.has(id))) return true;
    const species = name.replace(/^(?:.*?'s\s+|dark\s+|light\s+|radiant\s+|mega\s+|primal\s+|m\s+|alolan\s+|galarian\s+|hisuian\s+|bloodmoon\s+|therian\s+|incarnate\s+)+/, '')
        .replace(/\s+(?:ex|gx|v|vmax|vstar|lv\.?\s*x|break|radiant|delta species|therian|incarnate|galar|alola).*$/, '').trim();
    return NAMES.has(species);
}
