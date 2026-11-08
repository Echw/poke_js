import { writeFile } from 'node:fs/promises';

// Pin every input to one upstream revision so regeneration is reproducible.
const revision = process.argv[2] || (await get('https://api.github.com/repos/PokeAPI/pokeapi/commits/master')).sha;
async function get(url) {
    const response = await fetch(url, { headers: { 'User-Agent': 'pokejs-type-catalog' } });
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    return url.includes('api.github.com') ? response.json() : response.text();
}
async function csv(name) {
    const text = await get(`https://raw.githubusercontent.com/PokeAPI/pokeapi/${revision}/data/v2/csv/${name}.csv`);
    const [header, ...rows] = text.trim().split(/\r?\n/).map(line => line.split(','));
    return rows.map(values => Object.fromEntries(header.map((key, i) => [key, values[i]])));
}
const [pokemon, types, assignments, species] = await Promise.all(['pokemon', 'types', 'pokemon_types', 'pokemon_species'].map(csv));
const names = new Map(types.map(row => [row.id, row.identifier]));
const speciesNames = new Map(species.map(row => [row.id, row.identifier]));
const slots = new Map();
for (const row of assignments) {
    const list = slots.get(row.pokemon_id) || [];
    list[Number(row.slot) - 1] = names.get(row.type_id);
    slots.set(row.pokemon_id, list);
}
const entries = pokemon.map(row => [Number(row.species_id), row.identifier, speciesNames.get(row.species_id), slots.get(row.id), row.is_default === '1']);
const output = `// Generated from PokeAPI/pokeapi ${revision}. Do not edit by hand.\n// Source: https://github.com/PokeAPI/pokeapi/tree/${revision}/data/v2/csv\nexport const pokemonTypeRevision = '${revision}';\nexport const pokemonTypeData: readonly (readonly [number, string, string, readonly string[], boolean])[] = [\n${entries.map(row => '    ' + JSON.stringify(row)).join(',\n')}\n];\n`;
await writeFile(new URL('../src/data/pokemonTypeData.ts', import.meta.url), output);
console.log(`Generated ${entries.length} species/form entries at ${revision}`);
