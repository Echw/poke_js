import { useEffect, useState } from 'react';
import { getPokemonDetail, PokemonDetail } from './pokeapi';

export function usePokemonDetail(id: number | undefined) {
  const [pokemon, setPokemon] = useState<PokemonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(id !== undefined);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (id === undefined) {
      setPokemon(null);
      setLoading(false);
      return;
    }
    let active = true;
    setPokemon(null);
    setError(null);
    setLoading(true);
    getPokemonDetail(id)
      .then((result) => {
        if (active) setPokemon(result);
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
  }, [id, retryCount]);

  return { pokemon, error, loading, retry: () => setRetryCount((n) => n + 1) };
}
