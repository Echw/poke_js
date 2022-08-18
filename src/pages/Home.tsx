import React from 'react';
import { AiOutlineSearch } from 'react-icons/ai';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import Nav from '../components/Nav';

import styles from './Home.module.scss';

const Home = () => {
  return (
    <div>
      <Layout>
        <Nav />
        <div className={styles.search}>
          <h3>What Pokemon are you looking for?</h3>
          <div className={styles.inputContainer}>
            <input type="text" name="" id="" placeholder="Search" />
            <button>
              <AiOutlineSearch />
            </button>
          </div>
        </div>

        <div className={styles.allbutton}>
          <Link className={styles.link} to="/list">
            <button className={styles.button}>
              <p>I Generation</p>
              <div>
                <i></i> <i></i> <i></i>
              </div>
              <p>See All</p>
            </button>
          </Link>
        </div>
      </Layout>
    </div>
  );
};

export default Home;
