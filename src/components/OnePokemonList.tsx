import React from 'react';
import { Pokemon } from '../lib/context';

import styles from './OnePokemonList.module.scss';
interface PokemonProps {
  pokemon: Pokemon;
}

const OnePokemonList = (props: PokemonProps) => {
  return (
    <div className={styles.box}>
      <img src={props.pokemon.sprites.front_default} alt="" />
      <h4>{props.pokemon.name}</h4>
      <p>{props.pokemon.nat_dex_num}</p>
    </div>
  );
};

export default OnePokemonList;
