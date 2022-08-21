import React, { useState } from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import styles from './Home.module.scss';
import { Pokemon, usePokemonContext } from '../lib/context';

const Home = () => {
  const [enteredSearch, setEnteredSearch] = useState('');
  const [filteredSearch, setFilteredSearch] = useState<Pokemon[]>([]);
  const navigation = useNavigate();
  const { allPokemons } = usePokemonContext();

  const searchChangeHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEnteredSearch(event.target.value);
    const newFilter = allPokemons.filter((name) => {
      return name.name.includes(event.target.value);
    });
    setFilteredSearch(newFilter);
  };

  const onSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (enteredSearch.trim() === '') {
      return;
    }
    navigation('/pokemoninfo', { state: { enteredSearch } });
  };

  return (
    <div>
      <Layout>
        <Nav />
        <div className={styles.search}>
          <h3>What Pokemon are you looking for?</h3>
          <form className={styles.inputContainer} onSubmit={onSearchSubmit}>
            <input
              type="text"
              name=""
              id=""
              placeholder="Search"
              value={enteredSearch}
              onChange={searchChangeHandler}
            />
            <button>
              <AiOutlineSearch />
            </button>
          </form>
          {enteredSearch.length !== 0 && (
            <div className={styles.dataResult}>
              {filteredSearch.map((name) => {
                return (
                  <Link
                    className={styles.link}
                    to="/pokemoninfo"
                    state={{ enteredSearch: name.name }}
                  >
                    <div className={styles.nameItem}>
                      <p>{name.name}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.allbutton}>
          <Link className={styles.link} to="/list">
            <button className={styles.button}>
              <p>I Generation</p>
              {allPokemons.length > 0 && (
                <div>
                  <img
                    src={allPokemons[0].sprites.front_default}
                    alt={allPokemons[0].name}
                  />
                  <img
                    src={allPokemons[3].sprites.front_default}
                    alt={allPokemons[3].name}
                  />
                  <img
                    src={allPokemons[6].sprites.front_default}
                    alt={allPokemons[6].name}
                  />
                </div>
              )}
              <p>See All</p>
            </button>
          </Link>
        </div>
      </Layout>
    </div>
  );
};

export default Home;
