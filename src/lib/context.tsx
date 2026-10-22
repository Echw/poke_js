import { createContext, useContext, useEffect, useState } from 'react';
import Loading from '../components/Loading';
import { getGenerationOne, PokemonSummary } from './pokeapi';

const PokemonContext = createContext({
  allPokemons: [] as PokemonSummary[],
  pokedex: [] as PokemonSummary[],
  addPokemonToPokedex: (_pokemons: PokemonSummary[]) => {},
});

interface ProviderProps {
  children: React.ReactNode;
}

export const PokemonContextProvider = ({ children }: ProviderProps) => {
  const [allPokemons, setAllPokemons] = useState<PokemonSummary[]>([]);
  const [pokedex, addPokemonToPokedex] = useState<PokemonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getGenerationOne()
      .then((pokemons) => {
        if (active) setAllPokemons(pokemons);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retryCount]);

  if (loading) return <Loading />;
  if (error) {
    return (
      <div role="alert">
        <p>Could not load Pokémon from PokéAPI. {error}</p>
        <button onClick={() => setRetryCount((count) => count + 1)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <PokemonContext.Provider
      value={{ allPokemons, pokedex, addPokemonToPokedex }}
    >
      {children}
    </PokemonContext.Provider>
  );
};

export const usePokemonContext = () => useContext(PokemonContext);
