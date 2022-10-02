import { useQuery } from '@apollo/client';
import { createContext, useContext, useEffect, useState } from 'react';
import Loading from '../components/Loading';
import { GET_GEN1_POKEMONS } from './query';

const PokemonContext = createContext({
  allPokemons: [] as Pokemon[],
  pokedex: [] as Pokemon[],
  addPokemonToPokedex: (pokemons: Pokemon[]) => {},
});

interface ProviderProps {
  children: React.ReactNode;
}
export type Pokemon = {
  name: string;
  weight: number;
  height: number;
  color: string;
  nat_dex_num: number;
  sprites: { front_default: string };
  types: { name: string }[];
  moves: { name: string }[];
  base_stats: {
    hp: number;
    attack: number;
    defense: number;
    special_attack: number;
    special_defense: number;
    speed: number;
  };
  evolution_chain_start: {
    sprites: { front_default: string };
    evolves_to: {
      sprites: { front_default: string };
      evolves_to: { sprites: { front_default: string } }[];
    }[];
  };
};

export const PokemonContextProvider = (props: ProviderProps) => {
  const [pokemons, setPokemons] = useState<Pokemon[]>([]);
  const [addPokemon, setAddPokemon] = useState<Pokemon[]>([]);

  const { loading, error, data } = useQuery(GET_GEN1_POKEMONS, {
    variables: { limit: 151, game: 'firered' },
  });

  useEffect(() => {
    if (data?.allPokemon) setPokemons(data.allPokemon);
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <p> Oh no... {error.message}</p>;

  return (
    <PokemonContext.Provider
      value={{
        allPokemons: pokemons,
        pokedex: addPokemon,
        addPokemonToPokedex: setAddPokemon,
      }}
    >
      {props.children}
    </PokemonContext.Provider>
  );
};

export const usePokemonContext = () => useContext(PokemonContext);
