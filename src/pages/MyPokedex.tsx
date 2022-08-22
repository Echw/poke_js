import React from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import OnePokemonList from '../components/OnePokemonList';
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
          <div className={styles.itemsContainer}>
            {pokedex.map((pokemon) => (
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

export default MyPokedex;
