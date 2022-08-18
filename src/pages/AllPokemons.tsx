import React from 'react';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import OnePokemonList from '../components/OnePokemonList';
import styles from './AllPokemons.module.scss';
import { usePokemonContext } from '../lib/context';

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
              <OnePokemonList pokemon={pokemon} />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AllPokemons;
