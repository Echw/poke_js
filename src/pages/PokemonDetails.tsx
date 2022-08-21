import React from 'react';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import './PokemonDetails';
import styles from './PokemonDetails.module.scss';
import { FaWeight } from 'react-icons/fa';
import { FaRulerCombined } from 'react-icons/fa';
import { Link, useLocation } from 'react-router-dom';
import { usePokemonContext } from '../lib/context';

interface LocationState {
  enteredSearch?: string;
}

const PokemonDetails = () => {
  const { allPokemons } = usePokemonContext();
  const state = useLocation().state as LocationState;
  if (state === null || state === undefined) {
    return <p>Error</p>;
  }
  if (state.enteredSearch !== undefined && state.enteredSearch !== '') {
    const pokemon = allPokemons.find(
      (pokemon) => state.enteredSearch === pokemon.name
    );
    console.log(pokemon);
    if (pokemon !== undefined)
      return (
        <Layout>
          <Nav />
          <div className={styles.container}>
            <div className={styles.title}>
              <h1>{pokemon.name}</h1>
              <h3>{pokemon.nat_dex_num}</h3>
            </div>
            <div className={styles.detailsContainer}>
              <div className={styles.types}>
                <img src={pokemon.sprites.front_default} alt={pokemon.name} />
                <div className={styles.typeInfo}>
                  {pokemon.types.map((type) => (
                    <p key={pokemon.nat_dex_num}>{type.name}</p>
                  ))}
                </div>
                <Link className={styles.link} to="/addtopokedex">
                  <button className={styles.save}>Add to Pokedex</button>
                </Link>
              </div>
              <div className={styles.about}>
                <h2>About</h2>
                <div>
                  <div>
                    <FaWeight className="style.icon" />
                    <p>{pokemon.weight}g</p>
                    <h3>Weight</h3>
                  </div>
                  <div>
                    <FaRulerCombined className="style.icon" />
                    <p>{pokemon.height}cm</p>
                    <h3>Height</h3>
                  </div>
                  <div>
                    <p>{pokemon.moves[0].name}</p>
                    <p>{pokemon.moves[1].name}</p>
                    <h3>Moves</h3>
                  </div>
                </div>
              </div>
              <div className={styles.stats}>
                <h2>Base Stats</h2>
                <div className={styles.dataContainer}>
                  <div>
                    <h3>HP</h3>
                    <p>{pokemon.base_stats.hp}</p>
                  </div>
                  <div>
                    <h3>ATK</h3>
                    <p>{pokemon.base_stats.attack}</p>
                  </div>
                  <div>
                    <h3>DEF</h3>
                    <p>{pokemon.base_stats.defense}</p>
                  </div>
                  <div>
                    <h3>SATK</h3>
                    <p>{pokemon.base_stats.special_attack}</p>
                  </div>
                  <div>
                    <h3>SDEF</h3>
                    <p>{pokemon.base_stats.special_defense}</p>
                  </div>
                  <div>
                    <h3>SPD</h3>
                    <p>{pokemon.base_stats.speed}</p>
                  </div>
                </div>
              </div>
              <div className={styles.evolution}>
                <h2>Evolution Chain</h2>
                <div>
                  {pokemon.evolution_chain_start !== null && (
                    <>
                      <img
                        src={
                          pokemon.evolution_chain_start.sprites.front_default
                        }
                        alt="evolution chain 1"
                      />
                      {pokemon.evolution_chain_start.evolves_to !== null && (
                        <>
                          {pokemon.evolution_chain_start.evolves_to.map(
                            (evolve) => (
                              <img
                                src={evolve.sprites.front_default}
                                alt="evolution chain 2"
                              />
                            )
                          )}
                        </>
                      )}
                      {pokemon.evolution_chain_start.evolves_to[0]
                        .evolves_to !== null && (
                        <>
                          <img
                            src={
                              pokemon.evolution_chain_start.evolves_to[0]
                                .evolves_to[0].sprites.front_default
                            }
                            alt="evolution chain 3"
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Layout>
      );
  }
  return <div>Hello world</div>;
};

export default PokemonDetails;
