import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

const jsonResponse = (body: unknown) =>
  Promise.resolve({ ok: true, json: async () => body } as Response);

test('loads the Generation I list, searches, saves and reopens a Pokémon', async () => {
  const results = Array.from({ length: 151 }, (_, index) => {
    const id = index + 1;
    return {
      name: id === 1 ? 'bulbasaur' : `pokemon-${id}`,
      url: `https://pokeapi.co/api/v2/pokemon/${id}/`,
    };
  });
  const fetchMock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('pokemon?limit=151')) {
      return jsonResponse({ results });
    }
    if (url.endsWith('/pokemon/1')) {
      return jsonResponse({
        id: 1,
        name: 'bulbasaur',
        weight: 69,
        height: 7,
        sprites: { front_default: 'bulbasaur.png' },
        types: [
          { slot: 1, type: { name: 'grass', url: '' } },
        ],
        moves: [],
        stats: [{ base_stat: 45, stat: { name: 'hp', url: '' } }],
      });
    }
    if (url.endsWith('/pokemon-species/1')) {
      return jsonResponse({
        evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/1/' },
      });
    }
    if (url.endsWith('/evolution-chain/1/')) {
      return jsonResponse({
        chain: {
          species: { name: 'bulbasaur', url: 'https://pokeapi.co/api/v2/pokemon-species/1/' },
          evolves_to: [],
        },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  global.fetch = fetchMock as typeof fetch;

  render(<App />);
  expect(await screen.findByText('What Pokemon are you looking for?')).toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.click(screen.getByRole('link', { name: /I Generation/ }));
  expect(await screen.findByText('All Pokemons')).toBeInTheDocument();
  expect(screen.getAllByText(/^pokemon-\d+$/)).toHaveLength(150);
  fireEvent.click(screen.getByRole('link', { name: 'PokeJS' }));
  expect(await screen.findByText('What Pokemon are you looking for?')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Search'), {
    target: { value: 'Bulba' },
  });
  fireEvent.click(screen.getByText('bulbasaur'));
  expect(await screen.findByText('Base Stats')).toBeInTheDocument();
  expect(screen.getByText('6900g')).toBeInTheDocument();
  expect(screen.getByText('70cm')).toBeInTheDocument();

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.click(screen.getByRole('link', { name: 'Add to Pokedex' }));
  expect(await screen.findByText('Add Name')).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Name'), {
    target: { value: 'My Bulbasaur' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add to Pokedex' }));
  expect(await screen.findByText('My Pokedex')).toBeInTheDocument();
  fireEvent.click(screen.getByText('bulbasaur'));
  expect(await screen.findByText('Base Stats')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(4);
});
