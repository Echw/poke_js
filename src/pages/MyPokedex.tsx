import React from 'react';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import { usePokemonContext } from '../lib/context';
import styles from './AllPokemons.module.scss';

const MyPokedex = () => {
  const { pokedex } = usePokemonContext();

  return (
    <Layout>
      <Nav />
      <div className={styles.allContainer}>
        <div className={styles.insideContainer}>
          <h2>My Pokedex</h2>
          <div className={styles.itemsContainer}></div>
        </div>
      </div>
    </Layout>
  );
};

export default MyPokedex;
