import React from 'react';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import styles from './AllPokemons.module.scss';

const MyPokedex = () => {
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
