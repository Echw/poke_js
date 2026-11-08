import type { CardSelection } from './tcgdex';

// Verified 2026-11-08: https://pokeapi.co/api/v2/type/flying (both type slots).
// IDs below are National Dex IDs, never PokeAPI's alternate-form resource IDs.
const SPECIES = '6:charizard,12:butterfree,16:pidgey,17:pidgeotto,18:pidgeot,21:spearow,22:fearow,41:zubat,42:golbat,83:farfetchd,84:doduo,85:dodrio,123:scyther,130:gyarados,142:aerodactyl,144:articuno,145:zapdos,146:moltres,149:dragonite,163:hoothoot,164:noctowl,165:ledyba,166:ledian,169:crobat,176:togetic,177:natu,178:xatu,187:hoppip,188:skiploom,189:jumpluff,193:yanma,198:murkrow,207:gligar,225:delibird,226:mantine,227:skarmory,249:lugia,250:ho-oh,267:beautifly,276:taillow,277:swellow,278:wingull,279:pelipper,284:masquerain,291:ninjask,333:swablu,334:altaria,357:tropius,373:salamence,384:rayquaza,396:starly,397:staravia,398:staraptor,414:mothim,415:combee,416:vespiquen,425:drifloon,426:drifblim,430:honchkrow,441:chatot,458:mantyke,468:togekiss,469:yanmega,472:gliscor,519:pidove,520:tranquill,521:unfezant,527:woobat,528:swoobat,561:sigilyph,566:archen,567:archeops,580:ducklett,581:swanna,587:emolga,627:rufflet,628:braviary,629:vullaby,630:mandibuzz,641:tornadus,642:thundurus,645:landorus,661:fletchling,662:fletchinder,663:talonflame,666:vivillon,701:hawlucha,714:noibat,715:noivern,717:yveltal,722:rowlet,723:dartrix,731:pikipek,732:trumbeak,733:toucannon,741:oricorio,774:minior,797:celesteela,821:rookidee,822:corvisquire,823:corviknight,845:cramorant,905:enamorus,931:squawkabilly,940:wattrel,941:kilowattrel,962:bombirdier,973:flamigo,993:iron-jugulis'.split(',').map(entry => entry.split(':'));
const IDS = new Set(SPECIES.map(([id]) => Number(id)));
const NAMES = new Set(SPECIES.map(([, name]) => name.replace(/-/g, ' ')));

/** Resolve species/forms only; Colorless energy by itself is not evidence of Flying. */
export function isFlyingCard(card: CardSelection): boolean {
    const normalized = card.name.toLowerCase().replace(/[’']/g, "'").replace(/-/g, ' ');
    const name = normalized.replace(/'/g, '');
    const has = (id: number, species: string) => card.dexId.includes(id) || new RegExp('\\b' + species + '\\b').test(name);
    if (has(83, 'farfetchd') && /\b(galarian|galar)\b/.test(name)) return false;
    if (has(6, 'charizard') && /\b(?:mega|m)\b/.test(name) && /\bx\b/.test(name)) return false;
    if (has(130, 'gyarados') && /\b(?:mega|m)\b/.test(name)) return false;
    if (has(492, 'shaymin')) return /\bsky\b/.test(name);
    if (has(479, 'rotom')) return /\bfan\b/.test(name);
    if (has(127, 'pinsir') || has(36, 'clefable')) return /\b(?:mega|m)\b/.test(name);
    if (card.dexId.some(id => IDS.has(id))) return true;
    const species = normalized.replace(/^(?:.*?'s\s+|dark\s+|light\s+|radiant\s+|mega\s+|m\s+|galarian\s+|hisuian\s+|therian\s+|incarnate\s+)+/, '')
        .replace(/\s+(?:ex|gx|v|vmax|vstar|lv\.?\s*x|break|delta species|therian|incarnate).*$/, '').replace(/'/g, '').trim();
    return NAMES.has(species);
}
