import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import App from './App';

test('shows an API failure and lets the user retry', async () => {
  const results = Array.from({ length: 151 }, (_, index) => ({
    name: `pokemon-${index + 1}`,
    url: `https://pokeapi.co/api/v2/pokemon/${index + 1}/`,
  }));
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results }) });
  global.fetch = fetchMock as typeof fetch;

  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not load Pokémon from PokéAPI.'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('What Pokemon are you looking for?')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
