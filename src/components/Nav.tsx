import React from 'react';
import { MdCatchingPokemon } from 'react-icons/md';
import { Link } from 'react-router-dom';

import styles from './Nav.module.scss';

const Nav = () => {
  return (
    <div className={styles.nav}>
      <Link className={styles.link} to="/">
        <div>
          <MdCatchingPokemon className={styles.icon} />
          <h1 className={styles.h1}>PokeJS</h1>
        </div>
      </Link>
      <Link className={styles.link} to="/pokedex">
        <h2>Your Pokedex</h2>
      </Link>
    </div>
  );
};

export default Nav;
