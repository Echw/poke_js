import React from 'react';
import background from '../assets/image 1.png';

import styles from './Layout.module.scss';

interface NavProps {
  className?: string;
  children: React.ReactNode;
}

const Layout = (props: NavProps) => {
  return (
    <div>
      <div className={`${props.className} ${styles.container}`}>
        {props.children}
      </div>
      <img src={background} alt="pokemons" className={styles.img} />
    </div>
  );
};

export default Layout;
