const getColorByPokemonType = (pokemonType: string): string => {
  switch (pokemonType) {
    case 'Rock':
      return '#b69e31';
    case 'Ghost':
      return '#70559b';
    case 'Steel':
      return '#b7b9d0';
    case 'Water':
      return '#6493eb';
    case 'Grass':
      return '#74cb48';
    case 'Psychic':
      return '#fb5584';
    case 'Ice':
      return ' #9ad6df';
    case 'Dark':
      return '#75574c';
    case 'Fairy':
      return '#e69eac';
    case 'Normal':
      return '#aaa67f';
    case 'Fighting':
      return '#c12239';
    case 'Flying':
      return '#a891ec';
    case 'Poison':
      return '#a43e9e';
    case 'Ground':
      return '#dec16b';
    case 'Bug':
      return '#a7b723';
    case 'Fire':
      return '#f57d31';
    case 'Electric':
      return '#f9cf30';
    case 'Dragon':
      return '#7037ff';
    default:
      return '#aaa67f';
  }
};

export default getColorByPokemonType;
