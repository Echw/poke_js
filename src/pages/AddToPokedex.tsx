import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Loading from '../components/Loading';
import Nav from '../components/Nav';
import getColorByPokemonType from '../helpers/getColorByPokemonType';
import { zeroPad } from '../helpers/zeroPad';
import { usePokemonContext } from '../lib/context';
import { usePokemonDetail } from '../lib/usePokemonDetail';
import styles from './AddToPokedex.module.scss';

interface LocationState {
  enteredSearch?: string;
}

const AddToPokedex = () => {
  const [enteredPokemonName, setEnteredPokemonName] = useState('');
  const navigation = useNavigate();
  const locationState = useLocation().state as LocationState | null;

  const { addPokemonToPokedex, allPokemons, pokedex } = usePokemonContext();
  const name = locationState?.enteredSearch?.trim().toLowerCase();
  const chosenSummary = allPokemons.find((pokemon) => pokemon.name === name);
  const { pokemon: chosenPokemon, loading, error, retry } = usePokemonDetail(chosenSummary?.id);

  const pokemonNameHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEnteredPokemonName(event.target.value);
  };

  const onSaveSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (enteredPokemonName.trim() === '') {
      return;
    }
    if (!chosenSummary || !chosenPokemon) return;
    addPokemonToPokedex([chosenSummary, ...pokedex]);
    navigation('/pokedex');
  };

  if (!chosenSummary) {
    return <Layout><Nav /><p>No Pokémon found.</p></Layout>;
  }
  if (loading) {
    return <Layout><Nav /><Loading /></Layout>;
  }
  if (error || !chosenPokemon) {
    return (
      <Layout>
        <Nav />
        <div role="alert">
          <p>Could not load {chosenSummary.name}. {error}</p>
          <button onClick={retry}>Try again</button>
        </div>
      </Layout>
    );
  }

  if (chosenPokemon) {
    return (
      <Layout>
        <Nav />
        <div
          className={styles.container}
          style={{
            backgroundColor: getColorByPokemonType(chosenPokemon.types[0] || 'normal'),
          }}
        >
          <div className={styles.title}>
            <h1>{chosenPokemon.name}</h1>
            <h3>#{zeroPad(chosenPokemon.id, 3)}</h3>
          </div>
          <div className={styles.saveContainer}>
            <div className={styles.types}>
              <img
                src={chosenPokemon.sprite}
                alt={chosenPokemon.name}
              />
              <div className={styles.typeInfo}>
                {chosenPokemon.types.map((type) => (
                  <p
                    style={{
                      backgroundColor: getColorByPokemonType(type),
                    }}
                    key={type}
                  >
                    {type}
                  </p>
                ))}
              </div>
            </div>
            <div className={styles.addToPokedex}>
              <h3>Add Name</h3>
              <form className={styles.inputContainer} onSubmit={onSaveSubmit}>
                <input
                  type="text"
                  name=""
                  id=""
                  placeholder="Name"
                  value={enteredPokemonName}
                  onChange={pokemonNameHandler}
                />
                <button
                  style={{
                    backgroundColor: getColorByPokemonType(
                      chosenPokemon.types[0] || 'normal'
                    ),
                  }}
                >
                  Add to Pokedex
                </button>
              </form>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return <div>No pokemon found...</div>;
};

export default AddToPokedex;
