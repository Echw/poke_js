import React from 'react';
import { FaRulerCombined, FaWeight } from 'react-icons/fa';
import { Link, useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import Loading from '../components/Loading';
import Nav from '../components/Nav';
import getColorByPokemonType from '../helpers/getColorByPokemonType';
import { zeroPad } from '../helpers/zeroPad';
import { usePokemonContext } from '../lib/context';
import { EvolutionNode, StatName } from '../lib/pokeapi';
import { usePokemonDetail } from '../lib/usePokemonDetail';
import styles from './PokemonDetails.module.scss';

interface LocationState {
  enteredSearch?: string;
}

const statLabels: { name: StatName; label: string }[] = [
  { name: 'hp', label: 'HP' },
  { name: 'attack', label: 'ATK' },
  { name: 'defense', label: 'DEF' },
  { name: 'special-attack', label: 'SATK' },
  { name: 'special-defense', label: 'SDEF' },
  { name: 'speed', label: 'SPD' },
];

function EvolutionStage({ node }: { node: EvolutionNode }) {
  return (
    <div className={styles.evolutionBranch}>
      <div className={styles.evolutionPokemon}>
        <img src={node.sprite} alt={node.name} />
        <span>{node.name}</span>
      </div>
      {node.evolvesTo.length > 0 && (
        <div className={styles.evolutionChildren}>
          {node.evolvesTo.map((child) => (
            <EvolutionStage key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

const PokemonDetails = () => {
  const { allPokemons } = usePokemonContext();
  const state = useLocation().state as LocationState | null;
  const name = state?.enteredSearch?.trim().toLowerCase();
  const summary = allPokemons.find((pokemon) => pokemon.name === name);
  const { pokemon, loading, error, retry } = usePokemonDetail(summary?.id);

  if (!summary) {
    return <Layout><Nav /><p>No Pokémon found.</p></Layout>;
  }
  if (loading) {
    return <Layout><Nav /><Loading /></Layout>;
  }
  if (error || !pokemon) {
    return (
      <Layout>
        <Nav />
        <div role="alert">
          <p>Could not load {summary.name}. {error}</p>
          <button onClick={retry}>Try again</button>
        </div>
      </Layout>
    );
  }

  const primaryType = pokemon.types[0] || 'normal';

  return (
    <Layout>
      <Nav />
      <div
        className={styles.container}
        style={{ backgroundColor: getColorByPokemonType(primaryType) }}
      >
        <div className={styles.title}>
          <h1>{pokemon.name}</h1>
          <h3>#{zeroPad(pokemon.id, 3)}</h3>
        </div>
        <div className={styles.detailsContainer}>
          <div className={styles.types}>
            <img src={pokemon.sprite} alt={pokemon.name} />
            <div className={styles.typeInfo}>
              {pokemon.types.map((type) => (
                <p
                  key={type}
                  style={{ backgroundColor: getColorByPokemonType(type) }}
                >
                  {type}
                </p>
              ))}
            </div>
            <Link
              className={`${styles.link} ${styles.save}`}
              to="/addtopokedex"
              state={{ enteredSearch: pokemon.name }}
              style={{ backgroundColor: getColorByPokemonType(primaryType) }}
            >
              Add to Pokedex
            </Link>
          </div>
          <div className={styles.about}>
            <h2>About</h2>
            <div>
              <div>
                <FaWeight />
                <p>{pokemon.weightGrams}g</p>
                <h3>Weight</h3>
              </div>
              <div>
                <FaRulerCombined />
                <p>{pokemon.heightCentimeters}cm</p>
                <h3>Height</h3>
              </div>
              <div>
                {pokemon.moves.length > 0 ? (
                  pokemon.moves.map((move) => <p key={move}>{move}</p>)
                ) : (
                  <p>No moves available</p>
                )}
                <h3>Moves</h3>
              </div>
            </div>
          </div>
          <div className={styles.stats}>
            <h2>Base Stats</h2>
            <div className={styles.dataContainer}>
              {statLabels.map(({ name, label }) => (
                <div key={name}>
                  <h3>{label}</h3>
                  <p>{pokemon.stats[name] ?? '—'}</p>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.evolution}>
            <h2>Evolution Chain</h2>
            {pokemon.evolution ? (
              <EvolutionStage node={pokemon.evolution} />
            ) : (
              <p>No evolution data available.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default PokemonDetails;
