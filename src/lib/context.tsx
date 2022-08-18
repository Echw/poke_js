import { useQuery } from '@apollo/client';
import { createContext, useContext, useEffect, useState } from 'react';
import { GET_GEN1_POKEMONS } from './query';

const PokemonContext = createContext({
  allPokemons: [] as Pokemon[],
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
  types: { name: string };
  moves: { name: string };
  base_stats: {
    hp: number;
    attack: number;
    defense: number;
    special_attack: number;
    special_defense: number;
    speed: number;
  };
  evolves_to: { sprites: { front_default: string } };
  evolves_from: { sprites: { front_default: string } };
};

export const PokemonContextProvider = (props: ProviderProps) => {
  const [pokemons, setPokemons] = useState<Pokemon[]>([]);

  const { loading, error, data } = useQuery(GET_GEN1_POKEMONS, {
    variables: { limit: 151, game: 'firered' },
  });

  useEffect(() => {
    if (data?.allPokemon) setPokemons(data.allPokemon);
  }, [data]);

  if (loading) return <p>Loading...</p>;
  if (error) return <p> Oh no... {error.message}</p>;

  return (
    <PokemonContext.Provider
      value={{
        allPokemons: pokemons,
      }}
    >
      {props.children}
    </PokemonContext.Provider>
  );
};

export const usePokemonContext = () => useContext(PokemonContext);