import React from 'react';
import background from '../assets/image 1.png';

import './Layout.scss';

interface NavProps {
  className?: string;
  children: React.ReactNode;
}

const Layout = (props: NavProps) => {
  return (
    <div>
      <div className={`${props.className} container`}>{props.children}</div>{' '}
      <img src={background} alt="pokemons" className="img" />
    </div>
  );
};

export default Layout;
