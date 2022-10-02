import React from 'react';
import { zeroPad } from '../helpers/zeroPad';
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
      <p>#{zeroPad(props.pokemon.nat_dex_num, 3)}</p>
    </div>
  );
};

export default OnePokemonList;
