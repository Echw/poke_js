const API_ROOT = 'https://pokeapi.co/api/v2';
const FIRE_RED_LEAF_GREEN = 'firered-leafgreen';

export type PokemonSummary = {
  id: number;
  name: string;
  sprite: string;
};

export type StatName =
  | 'hp'
  | 'attack'
  | 'defense'
  | 'special-attack'
  | 'special-defense'
  | 'speed';

export type EvolutionNode = PokemonSummary & {
  evolvesTo: EvolutionNode[];
};

export type PokemonDetail = PokemonSummary & {
  types: string[];
  moves: string[];
  stats: Partial<Record<StatName, number>>;
  weightGrams: number;
  heightCentimeters: number;
  evolution: EvolutionNode | null;
};

type NamedResource = { name: string; url: string };
type PokemonListResponse = { results: NamedResource[] };
type PokemonResponse = {
  id: number;
  name: string;
  weight: number;
  height: number;
  sprites: { front_default: string | null };
  types: { slot: number; type: NamedResource }[];
  moves: {
    move: NamedResource;
    version_group_details: { version_group: NamedResource }[];
  }[];
  stats: { base_stat: number; stat: NamedResource }[];
};
type PokemonSpeciesResponse = { evolution_chain: { url: string } | null };
export type EvolutionLinkResponse = {
  species: NamedResource;
  evolves_to: EvolutionLinkResponse[];
};
type EvolutionChainResponse = { chain: EvolutionLinkResponse };

const resourceCache = new Map<string, Promise<unknown>>();
const detailCache = new Map<number, Promise<PokemonDetail>>();

async function fetchResource<T>(url: string): Promise<T> {
  if (!resourceCache.has(url)) {
    const request = fetch(url).then(async (response) => {
      if (!response.ok) {
        throw new Error(`PokéAPI returned ${response.status}.`);
      }
      return response.json() as Promise<T>;
    });
    resourceCache.set(url, request);
    request.catch(() => resourceCache.delete(url));
  }
  return resourceCache.get(url) as Promise<T>;
}

export function resourceId(url: string): number {
  const match = url.match(/\/(\d+)\/?$/);
  if (!match) throw new Error(`Invalid PokéAPI resource URL: ${url}`);
  return Number(match[1]);
}

export function spriteUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
}

export async function getGenerationOne(): Promise<PokemonSummary[]> {
  const data = await fetchResource<PokemonListResponse>(
    `${API_ROOT}/pokemon?limit=151&offset=0`
  );
  if (data.results.length !== 151) {
    throw new Error('PokéAPI returned an incomplete Generation I list.');
  }
  return data.results.map(({ name, url }) => {
    const id = resourceId(url);
    return { id, name, sprite: spriteUrl(id) };
  });
}

export function mapEvolutionChain(link: EvolutionLinkResponse): EvolutionNode {
  const id = resourceId(link.species.url);
  return {
    id,
    name: link.species.name,
    sprite: spriteUrl(id),
    evolvesTo: link.evolves_to.map(mapEvolutionChain),
  };
}

export function mapPokemonDetail(
  raw: PokemonResponse,
  evolution: EvolutionNode | null
): PokemonDetail {
  const stats: PokemonDetail['stats'] = {};
  for (const item of raw.stats) {
    stats[item.stat.name as StatName] = item.base_stat;
  }

  return {
    id: raw.id,
    name: raw.name,
    sprite: raw.sprites.front_default || spriteUrl(raw.id),
    types: [...raw.types]
      .sort((a, b) => a.slot - b.slot)
      .map(({ type }) => type.name),
    moves: raw.moves
      .filter(({ version_group_details }) =>
        version_group_details.some(
          ({ version_group }) => version_group.name === FIRE_RED_LEAF_GREEN
        )
      )
      .map(({ move }) => move.name)
      .slice(0, 2),
    stats,
    weightGrams: raw.weight * 100,
    heightCentimeters: raw.height * 10,
    evolution,
  };
}

export function getPokemonDetail(id: number): Promise<PokemonDetail> {
  if (!detailCache.has(id)) {
    const request = Promise.all([
      fetchResource<PokemonResponse>(`${API_ROOT}/pokemon/${id}`),
      fetchResource<PokemonSpeciesResponse>(`${API_ROOT}/pokemon-species/${id}`),
    ]).then(async ([pokemon, species]) => {
      const evolution = species.evolution_chain
        ? mapEvolutionChain(
            (await fetchResource<EvolutionChainResponse>(species.evolution_chain.url))
              .chain
          )
        : null;
      return mapPokemonDetail(pokemon, evolution);
    });
    detailCache.set(id, request);
    request.catch(() => detailCache.delete(id));
  }
  return detailCache.get(id)!;
}
