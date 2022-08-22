import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import getColorByPokemonType from '../helpers/getColorByPokemonType';
import { Pokemon, usePokemonContext } from '../lib/context';
import styles from './AddToPokedex.module.scss';

interface LocationState {
  enteredSearch?: string;
}

const AddToPokedex = () => {
  const [enteredPokemonName, setEnteredPokemonName] = useState('');
  const [chosenPokemon, setChosenPokemon] = useState<Pokemon>();

  const navigation = useNavigate();
  const locationState = useLocation().state as LocationState;

  const { addPokemonToPokedex, allPokemons, pokedex } = usePokemonContext();

  const pokemonNameHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEnteredPokemonName(event.target.value);
  };

  useEffect(() => {
    if (locationState === null || locationState === undefined) {
      return;
    }
    if (
      locationState.enteredSearch !== undefined &&
      locationState.enteredSearch !== ''
    ) {
      const pokemon = allPokemons.find(
        (pokemon) => locationState.enteredSearch === pokemon.name
      );
      setChosenPokemon(pokemon);
    }
  }, [allPokemons, locationState]);

  const onSaveSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (enteredPokemonName.trim() === '') {
      return;
    }
    if (chosenPokemon === undefined) return;
    addPokemonToPokedex([chosenPokemon, ...pokedex]);
    navigation('/pokedex');
  };

  if (chosenPokemon !== undefined) {
    return (
      <Layout>
        <Nav />
        <div
          className={styles.container}
          style={{
            backgroundColor: getColorByPokemonType(chosenPokemon.types[0].name),
          }}
        >
          <div className={styles.title}>
            <h1>{chosenPokemon.name}</h1>
            <h3>{chosenPokemon.nat_dex_num}</h3>
          </div>
          <div className={styles.saveContainer}>
            <div className={styles.types}>
              <img
                src={chosenPokemon.sprites.front_default}
                alt={chosenPokemon.name}
              />
              <div className={styles.typeInfo}>
                {chosenPokemon.types.map((type) => (
                  <p
                    style={{
                      backgroundColor: getColorByPokemonType(type.name),
                    }}
                    key={chosenPokemon.nat_dex_num}
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
                      chosenPokemon.types[0].name
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
