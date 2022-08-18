import React from 'react';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import './PokemonDetails';
import styles from './PokemonDetails.module.scss';
import { FaWeight } from 'react-icons/fa';
import { FaRulerCombined } from 'react-icons/fa';
import { Link } from 'react-router-dom';

const PokemonDetails = () => {
  return (
    <Layout>
      <Nav />
      <div className={styles.container}>
        <div className={styles.title}>
          <h1>Bulbasaur</h1>
          <h3>#001</h3>
        </div>
        <div className={styles.detailsContainer}>
          <div className={styles.types}>
            <img src="" alt="" />
            <div className={styles.typeInfo}>
              <p>Grass</p>
              <p>Poison</p>{' '}
            </div>
            <Link className={styles.link} to="/addtopokedex">
              <button className={styles.save}>Add to Pokedex</button>
            </Link>
          </div>
          <div className={styles.about}>
            <h2>About</h2>
            <div>
              <div>
                <FaWeight className="style.icon" />
                <p>6.9kg</p>
                <h3>Weight</h3>
              </div>
              <div>
                <FaRulerCombined className="style.icon" />
                <p>0,7m</p>
                <h3>Height</h3>
              </div>
              <div>
                <p>Chlorophyll</p>
                <p>Overgrow</p>
                <h3>Moves</h3>
              </div>
            </div>
          </div>
          <div className={styles.stats}>
            <h2>Base Stats</h2>
            <div className={styles.dataContainer}>
              <div>
                <h3>HP</h3>
                <p>045</p>
              </div>
              <div>
                <h3>ATK</h3>
                <p>049</p>
              </div>
              <div>
                <h3>DEF</h3>
                <p>049</p>
              </div>
              <div>
                <h3>SATK</h3>
                <p>065</p>
              </div>
              <div>
                <h3>SDEF</h3>
                <p>065</p>
              </div>
              <div>
                <h3>SPD</h3>
                <p>045</p>
              </div>
            </div>
          </div>
          <div className={styles.evolution}>
            <h2>Evolution Chain</h2>
            <div>
              <img src="" alt="" />
              <img src="" alt="" />
              <img src="" alt="" />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default PokemonDetails;
