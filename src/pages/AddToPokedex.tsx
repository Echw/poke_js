import React from 'react';
import Layout from '../components/Layout';
import Nav from '../components/Nav';
import styles from './AddToPokedex.module.scss';

const AddToPokedex = () => {
  return (
    <Layout>
      <Nav />
      <div className={styles.container}>
        <div className={styles.title}>
          <h1>Bulbasaur</h1>
          <h3>#001</h3>
        </div>
        <div className={styles.saveContainer}>
          <div>
            <img src="" alt="" />
            <div className={styles.typeInfo}>
              <p>Grass</p>
              <p>Poison</p>
            </div>
          </div>
          <div className={styles.addToPokedex}>
            <h3>Add Name</h3>
            <div className={styles.inputContainer}>
              <input type="text" name="" id="" placeholder="Name" />
              <button>Add to Pokedex</button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default AddToPokedex;
