import React from 'react';
import { zeroPad } from '../helpers/zeroPad';
import { PokemonSummary } from '../lib/pokeapi';

import styles from './OnePokemonList.module.scss';
interface PokemonProps {
  pokemon: PokemonSummary;
}

const OnePokemonList = (props: PokemonProps) => {
  return (
    <div className={styles.box}>
      <img src={props.pokemon.sprite} alt={props.pokemon.name} />
      <h4>{props.pokemon.name}</h4>
      <p>#{zeroPad(props.pokemon.id, 3)}</p>
    </div>
  );
};

export default OnePokemonList;
