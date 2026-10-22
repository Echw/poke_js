import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './roots/AppRoutes';
import { PokemonContextProvider } from './lib/context';

function App() {
  return (
    <PokemonContextProvider>
      <BrowserRouter basename={window.location.pathname || ''}>
        <AppRoutes />
      </BrowserRouter>
    </PokemonContextProvider>
  );
}

export default App;
