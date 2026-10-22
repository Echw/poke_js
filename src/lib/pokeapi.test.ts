import { mapEvolutionChain, mapPokemonDetail } from './pokeapi';

const species = (id: number, name: string) => ({
  name,
  url: `https://pokeapi.co/api/v2/pokemon-species/${id}/`,
});

test('maps Pokémon details, FireRed/LeafGreen moves, stats and units', () => {
  const pokemon = mapPokemonDetail(
    {
      id: 1,
      name: 'bulbasaur',
      weight: 69,
      height: 7,
      sprites: { front_default: 'bulbasaur.png' },
      types: [
        { slot: 2, type: species(4, 'poison') },
        { slot: 1, type: species(12, 'grass') },
      ],
      moves: [
        {
          move: species(1, 'tackle'),
          version_group_details: [
            { version_group: species(1, 'firered-leafgreen') },
          ],
        },
        {
          move: species(2, 'modern-move'),
          version_group_details: [
            { version_group: species(2, 'sword-shield') },
          ],
        },
      ],
      stats: [
        { base_stat: 45, stat: species(1, 'hp') },
        { base_stat: 49, stat: species(2, 'attack') },
      ],
    },
    null
  );

  expect(pokemon.types).toEqual(['grass', 'poison']);
  expect(pokemon.moves).toEqual(['tackle']);
  expect(pokemon.stats).toEqual({ hp: 45, attack: 49 });
  expect(pokemon.weightGrams).toBe(6900);
  expect(pokemon.heightCentimeters).toBe(70);
});

test('preserves every branch and handles a Pokémon without evolutions', () => {
  const eevee = mapEvolutionChain({
    species: species(133, 'eevee'),
    evolves_to: [
      { species: species(134, 'vaporeon'), evolves_to: [] },
      { species: species(135, 'jolteon'), evolves_to: [] },
      { species: species(136, 'flareon'), evolves_to: [] },
    ],
  });
  const ditto = mapEvolutionChain({
    species: species(132, 'ditto'),
    evolves_to: [],
  });

  expect(eevee.evolvesTo.map((node) => node.name)).toEqual([
    'vaporeon',
    'jolteon',
    'flareon',
  ]);
  expect(ditto.evolvesTo).toEqual([]);
});
