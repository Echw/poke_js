import { isFlyingCard } from './flyingSpecies.ts';
import { speciesRevealType } from './pokemonTypes.ts';
import { isGroundCard } from './groundSpecies.ts';
import { isPoisonCard } from './poisonSpecies.ts';
import type { RevealType } from '../effects/types';
import type { CardSelection } from './tcgdex';

// National Dex identities, not the TCG energy type or the user's search query.
const ICE_SPECIES = new Set([
    87, 91, 124, 131, 144, 215, 220, 221, 225, 238, 361, 362, 363, 364, 365, 378, 459, 460, 461, 471, 473,
    478, 582, 583, 584, 613, 614, 615, 646, 698, 699, 712, 713, 740, 866, 875, 872, 873, 883, 896, 974, 975,
    991, 996, 997, 998,
]);
const REGIONAL_ICE: Record<number, string> = {
    27: 'alolan',
    28: 'alolan',
    37: 'alolan',
    38: 'alolan',
    122: 'galarian',
    351: 'snowy',
    479: 'frost',
    554: 'galarian',
    555: 'galarian',
};
const ICE_NAMES = /\b(glaceon|ice rider calyrex|black kyurem|white kyurem)\b/i;

/** Resolve the actual selected species/form; Water energy alone never selects Ice. */
export function revealTypeForCard(card: CardSelection): RevealType {
    const speciesType = speciesRevealType(card);
    if (speciesType) return speciesType;
    if (isPoisonCard(card)) return 'poison';
    const name = card.name.toLowerCase();
    // Galarian Articuno and Hisuian Sneasel change away from their original Ice typing.
    if (
        (card.dexId.includes(144) && name.includes('galarian')) ||
        (card.dexId.includes(215) && name.includes('hisuian'))
    )
        return 'psychic';
    const ice =
        ICE_NAMES.test(name) ||
        card.dexId.some(
            (id) => ICE_SPECIES.has(id) || Boolean(REGIONAL_ICE[id] && name.includes(REGIONAL_ICE[id])),
        );
    if (ice) return 'ice';
    if (isGroundCard(card)) return 'ground';
    if (card.types.includes('Metal')) return 'steel';
    if (card.types.includes('Dragon')) return 'dragon';
    if (card.types.includes('Darkness')) return 'dark';
    if (card.types.includes('Fighting')) return 'fighting';
    return card.types.includes('Lightning')
        ? 'electric'
        : card.types.includes('Grass')
          ? 'grass'
          : card.types.includes('Fire')
            ? 'fire'
            : card.types.includes('Water')
              ? 'water'
              : !card.types.includes('Psychic') && isFlyingCard(card) ? 'flying' : 'psychic';
}
