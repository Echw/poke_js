import React from 'react';
import { MdCatchingPokemon } from 'react-icons/md';

import './Nav.scss';

const Nav = () => {
  return (
    <div className="nav">
      <div>
        <MdCatchingPokemon className="icon" />
        <h1 className="h1">PokeJS</h1>
      </div>
      <h2>Your Pokedex</h2>
    </div>
  );
};

export default Nav;
