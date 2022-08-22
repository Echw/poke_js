import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import getColorByPokemonType from '../helpers/getColorByPokemonType';
import { usePokemonContext } from '../lib/context';
import styles from './AddToPokedex.module.scss';

interface LocationState {
  enteredSearch?: string;
}

const AddToPokedex = () => {
  const [enteredPokemonName, setEnteredPokemonName] = useState('');
  const navigation = useNavigate();

  const pokemonNameHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEnteredPokemonName(event.target.value);
  };

  const onSaveSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (enteredPokemonName.trim() === '') {
      return;
    }
    navigation('/pokedex');
  };

  const { allPokemons } = usePokemonContext();
  const state = useLocation().state as LocationState;
  if (state === null || state === undefined) {
    return <p>Error</p>;
  }
  if (state.enteredSearch !== undefined && state.enteredSearch !== '') {
    const pokemon = allPokemons.find(
      (pokemon) => state.enteredSearch === pokemon.name
    );
    console.log(enteredPokemonName);

    if (pokemon !== undefined)
      return (
        <Layout>
          <Nav />
          <div
            className={styles.container}
            style={{
              backgroundColor: getColorByPokemonType(pokemon.types[0].name),
            }}
          >
            <div className={styles.title}>
              <h1>{pokemon.name}</h1>
              <h3>{pokemon.nat_dex_num}</h3>
            </div>
            <div className={styles.saveContainer}>
              <div className={styles.types}>
                <img src={pokemon.sprites.front_default} alt={pokemon.name} />
                <div className={styles.typeInfo}>
                  {pokemon.types.map((type) => (
                    <p
                      style={{
                        backgroundColor: getColorByPokemonType(type.name),
                      }}
                      key={pokemon.nat_dex_num}
                    >
                      {type.name}
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
                        pokemon.types[0].name
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
  return <div>Hello world</div>;
};

export default AddToPokedex;
