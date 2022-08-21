import { gql } from '@apollo/client';

export const GET_GEN1_POKEMONS = gql`
  query ($limit: Int, $game: String!) {
    allPokemon(limit: $limit) {
      name
      weight
      height
      sprites {
        front_default
      }
      types {
        name
      }
      moves(game: $game) {
        name
      }

      base_stats {
        hp
        attack
        defense
        special_attack
        special_defense
        speed
      }
      evolves_to {
        sprites {
          front_default
        }
      }
      evolves_from {
        sprites {
          front_default
        }
      }
      color
      nat_dex_num
      evolution_chain_start {
        sprites {
          front_default
        }
        evolves_to {
          sprites {
            front_default
          }
          evolves_to {
            sprites {
              front_default
            }
          }
        }
      }
    }
  }
`;
