import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './roots/AppRoutes';
import { ApolloClient, InMemoryCache, ApolloProvider } from '@apollo/client';
import { PokemonContextProvider } from './lib/context';

const client = new ApolloClient({
  uri: 'https://dex-server.herokuapp.com/',
  cache: new InMemoryCache(),
});

function App() {
  return (
    <ApolloProvider client={client}>
      <PokemonContextProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </PokemonContextProvider>
    </ApolloProvider>
  );
}

export default App;
