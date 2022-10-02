import React from 'react';
import { MdCatchingPokemon } from 'react-icons/md';
import styles from './Loading.module.scss';

const Loading = () => {
  return (
    <div className={styles.wrapper}>
      <div className={styles.triple_spinner} />
      <MdCatchingPokemon className={styles.icon} />
    </div>
  );
};

export default Loading;
