import React from 'react';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import OnePokemonList from '../components/OnePokemonList';
import styles from './AllPokemons.module.scss';
import { usePokemonContext } from '../lib/context';
import { Link } from 'react-router-dom';

const AllPokemons = () => {
  const { allPokemons } = usePokemonContext();

  return (
    <Layout>
      <Nav />
      <div className={styles.allContainer}>
        <div className={styles.insideContainer}>
          <h2>All Pokemons</h2>
          <div className={styles.itemsContainer}>
            {allPokemons.map((pokemon) => (
              <Link
                className={styles.link}
                to="/pokemoninfo"
                state={{ enteredSearch: pokemon.name }}
              >
                <OnePokemonList pokemon={pokemon} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AllPokemons;
