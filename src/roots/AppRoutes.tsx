import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from '../pages/Home';
import PokemonDetails from '../pages/PokemonDetails';
import AddToPokedex from '../pages/AddToPokedex';

const AppRoutes = () => {
  return (
    <div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="pokemoninfo" element={<PokemonDetails />} />
        <Route path="addtopokedex" element={<AddToPokedex />} />
      </Routes>
    </div>
  );
};

export default AppRoutes;
