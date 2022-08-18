import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Home from '../pages/Home';
import PokemonDetails from '../pages/PokemonDetails';
import AddToPokedex from '../pages/AddToPokedex';
import AllPokemons from './../pages/AllPokemons';
import MyPokedex from './../pages/MyPokedex';

const AppRoutes = () => {
  return (
    <div>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="pokemoninfo" element={<PokemonDetails />} />
        <Route path="addtopokedex" element={<AddToPokedex />} />
        <Route path="list" element={<AllPokemons />} />
        <Route path="pokedex" element={<MyPokedex />} />
      </Routes>
    </div>
  );
};

export default AppRoutes;
