// ─────────────────────────────────────────────────────────────────────────────
// THEME: every name, sprite, type, move, tile and card text lives here.
// Swap this file to reskin the whole game (e.g. to original creatures).
// Gameplay numbers live in config.ts, not here.
// ─────────────────────────────────────────────────────────────────────────────

export const GAME_TITLE = 'PokéBoard';
export const CURRENCY = '₽';

/** Themed words used in UI copy. */
export const WORDS = {
  creature: 'Pokémon',
  creatures: 'Pokémon',
  starter: 'Starter',
  legendary: 'Legendary',
  grunt: 'Rocket Grunt',
  gruntTeam: 'Team Rocket',
  hideout: 'Rocket Hideout',
  hideoutShort: 'Hideout',
  guard: 'hideout guard',
  escapeRope: 'Escape Rope',
  buyVerb: 'Catch',
  release: 'Release',
  card: 'Wild Encounter',
};

// ── Types ────────────────────────────────────────────────────────────────────

export type TypeId =
  | 'fire'
  | 'water'
  | 'grass'
  | 'electric'
  | 'ground'
  | 'psychic'
  | 'fighting'
  | 'dark'
  | 'ghost'
  | 'fairy'
  | 'poison'
  | 'normal';

export interface TypeDef {
  name: string;
  /** 3-letter label for tight spaces (type chart columns). */
  short: string;
  color: string;
  /** Name of this type's shared "type move". */
  move: string;
}

export const TYPES: Record<TypeId, TypeDef> = {
  fire: { name: 'Fire', short: 'FIR', color: '#F47A26', move: 'Ember' },
  water: { name: 'Water', short: 'WTR', color: '#3A8DF0', move: 'Water Gun' },
  grass: { name: 'Grass', short: 'GRS', color: '#4DB046', move: 'Razor Leaf' },
  electric: { name: 'Electric', short: 'ELE', color: '#F3C200', move: 'Thunder Shock' },
  ground: { name: 'Ground', short: 'GRD', color: '#C58A3D', move: 'Mud Shot' },
  psychic: { name: 'Psychic', short: 'PSY', color: '#EE4F97', move: 'Confusion' },
  fighting: { name: 'Fighting', short: 'FGT', color: '#D64A3A', move: 'Karate Chop' },
  // Dark is charcoal (was purple-grey #5A5173) so it can't be confused with Ghost.
  dark: { name: 'Dark', short: 'DRK', color: '#4A4A57', move: 'Bite' },
  ghost: { name: 'Ghost', short: 'GHO', color: '#5B4FB0', move: 'Shadow Sneak' },
  // Light pink: anything drawn directly on it uses ink text (textOn() picks it automatically).
  fairy: { name: 'Fairy', short: 'FAI', color: '#F7B0DA', move: 'Fairy Wind' },
  poison: { name: 'Poison', short: 'PSN', color: '#A845B8', move: 'Poison Sting' },
  normal: { name: 'Normal', short: 'NRM', color: '#8C8A5E', move: 'Swift' },
};

/** Battle background gradient (top → bottom), by the defender's type. */
export const BATTLE_GRADIENTS: Record<TypeId, [string, string]> = {
  grass: ['#6CC24A', '#2F9A4C'],
  fire: ['#FF9A3D', '#E0561A'],
  water: ['#4FA8FF', '#2466D6'],
  electric: ['#FFD93B', '#E0A800'],
  ground: ['#D9A55A', '#A56B2A'],
  fighting: ['#E8644F', '#B5302A'],
  dark: ['#6A6A7A', '#33333F'],
  psychic: ['#FF72B0', '#D1337C'],
  ghost: ['#7A6FD0', '#3F3590'],
  fairy: ['#FFC4E6', '#E77DBB'],
  poison: ['#C566D4', '#7E2C8F'],
  normal: ['#B3B184', '#76744A'],
};
/** Grunt battles (ambush, hideout guard) always use this, not the grunt's type. */
export const GRUNT_BATTLE_GRADIENT: [string, string] = ['#5A4380', '#2B1F42'];

/** Attacker type → types its type move is strong against. The reverse matchup is resisted. */
export const TYPE_CHART: Record<TypeId, TypeId[]> = {
  fire: ['grass'],
  water: ['fire', 'ground'],
  grass: ['water', 'ground'],
  electric: ['water'],
  ground: ['fire', 'electric', 'poison'],
  psychic: ['fighting', 'poison'],
  fighting: ['dark'],
  dark: ['psychic', 'ghost'],
  ghost: ['psychic'],
  fairy: ['fighting', 'dark'],
  poison: ['grass', 'fairy'],
  normal: [],
};

/** The type with no strengths or weaknesses (starters and grunts use it). */
export const NEUTRAL_TYPE: TypeId = 'normal';

export const MOVES = {
  tackle: 'Tackle',
  protect: 'Protect',
};

export const LEGENDARY_BORDER = '#FFD23F';

/** Background for the guard move (Protect) button in battle. */
export const PROTECT_COLOR = '#2E9A8F';

/** Solid colors for non-creature tiles, by tile kind. */
export const SPECIAL_TILE_COLORS: Partial<Record<TileKind, string>> = {
  go: '#FFD23F',
  card: '#1D2B5E',
  hideout: '#3A2A55',
  ambush: '#3A2A55',
  goToHideout: '#3A2A55',
  safari: '#1F7F45',
  bonus: '#E0457B',
};

/** Shown in the setup-screen footer. */
export const SPRITE_CREDIT = 'Sprites load from the PokéAPI sprites repository.';

// ── Sprites ──────────────────────────────────────────────────────────────────

/** 3D-style renders. There are no back views; battle mirrors the attacker instead. */
const RENDER_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/home';
export const renderImage = (dex: number) => `${RENDER_BASE}/${dex}.png`;

// ── Creatures ────────────────────────────────────────────────────────────────

export interface Form {
  name: string;
  dex: number;
}

/** Starters double as player tokens. They never sit on a tile. */
export const STARTERS: Form[] = [
  { name: 'Eevee', dex: 133 },
  { name: 'Meowth', dex: 52 },
  { name: 'Jigglypuff', dex: 39 },
  { name: 'Teddiursa', dex: 216 },
];

/** Grunt creatures (one is picked at random per grunt battle). */
export const GRUNTS: Form[] = [
  { name: 'Rattata', dex: 19 },
  { name: 'Ekans', dex: 23 }, // was Zubat, now a catchable Poison creature
  { name: 'Koffing', dex: 109 },
];

// ── Board ────────────────────────────────────────────────────────────────────

export type TileKind =
  | 'go'
  | 'pokemon'
  | 'legendary'
  | 'card'
  | 'hideout'
  | 'bonus'
  | 'safari'
  | 'ambush'
  | 'goToHideout';

export interface TileDef {
  kind: TileKind;
  name: string;
  /** Short label for corner/special tiles on small screens. */
  short?: string;
  type?: TypeId;
  /** Evolution stages (1 entry for legendaries, 3 for regular creatures). */
  forms?: Form[];
}

const mon = (type: TypeId, ...forms: [string, number][]): TileDef => ({
  kind: 'pokemon',
  name: forms[0][0],
  type,
  forms: forms.map(([name, dex]) => ({ name, dex })),
});
const legend = (type: TypeId, name: string, dex: number): TileDef => ({
  kind: 'legendary',
  name,
  type,
  forms: [{ name, dex }],
});

/**
 * The classic (fixed) board. Index 0 is the bottom-right corner; movement is clockwise.
 * Its non-creature tiles are also the fixed skeleton every shuffled board is built on.
 * Game code reads tiles from GameState.board, never from here directly.
 */
export const CLASSIC_BOARD: TileDef[] = [
  { kind: 'go', name: 'GO', short: 'GO' },
  mon('grass', ['Bulbasaur', 1], ['Ivysaur', 2], ['Venusaur', 3]),
  { kind: 'card', name: 'Wild Encounter', short: '?' },
  mon('grass', ['Chikorita', 152], ['Bayleef', 153], ['Meganium', 154]),
  legend('fire', 'Moltres', 146),
  mon('ground', ['Trapinch', 328], ['Vibrava', 329], ['Flygon', 330]),
  mon('ground', ['Gible', 443], ['Gabite', 444], ['Garchomp', 445]),
  { kind: 'hideout', name: 'Rocket Hideout', short: 'Hideout' },
  mon('water', ['Squirtle', 7], ['Wartortle', 8], ['Blastoise', 9]),
  mon('water', ['Totodile', 158], ['Croconaw', 159], ['Feraligatr', 160]),
  { kind: 'bonus', name: 'Pokémon Center', short: 'Center' },
  legend('electric', 'Zapdos', 145),
  mon('fighting', ['Machop', 66], ['Machoke', 67], ['Machamp', 68]),
  mon('fighting', ['Timburr', 532], ['Gurdurr', 533], ['Conkeldurr', 534]),
  { kind: 'safari', name: 'Safari Zone', short: 'Safari' },
  mon('fire', ['Charmander', 4], ['Charmeleon', 5], ['Charizard', 6]),
  { kind: 'ambush', name: 'Rocket Ambush', short: 'Ambush' },
  mon('fire', ['Cyndaquil', 155], ['Quilava', 156], ['Typhlosion', 157]),
  legend('water', 'Kyogre', 382),
  mon('electric', ['Pichu', 172], ['Pikachu', 25], ['Raichu', 26]),
  mon('electric', ['Mareep', 179], ['Flaaffy', 180], ['Ampharos', 181]),
  { kind: 'goToHideout', name: 'Go to Hideout', short: 'Go to Hideout' },
  mon('dark', ['Sandile', 551], ['Krokorok', 552], ['Krookodile', 553]),
  mon('dark', ['Deino', 633], ['Zweilous', 634], ['Hydreigon', 635]),
  { kind: 'card', name: 'Wild Encounter', short: '?' },
  legend('psychic', 'Mewtwo', 150),
  mon('psychic', ['Abra', 63], ['Kadabra', 64], ['Alakazam', 65]),
  mon('psychic', ['Ralts', 280], ['Kirlia', 281], ['Gardevoir', 282]),
];

// ── Shuffled boards ──────────────────────────────────────────────────────────

export type SlotId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

/** Pair slots: two tiles that always share a type and a price (prices in config.ts, by tile index). */
export const PAIR_SLOTS: { id: SlotId; tiles: [number, number] }[] = [
  { id: 'A', tiles: [1, 3] },
  { id: 'B', tiles: [5, 6] },
  { id: 'C', tiles: [8, 9] },
  { id: 'D', tiles: [12, 13] },
  { id: 'E', tiles: [15, 17] },
  { id: 'F', tiles: [19, 20] },
  { id: 'G', tiles: [22, 23] },
  { id: 'H', tiles: [26, 27] },
];

/** Legendary tiles, in the order shuffled legendaries are assigned. */
export const LEGENDARY_SLOTS = [4, 11, 18, 25];

/**
 * Every type that can get a pair on a shuffled board (the one place this list lives).
 * Each shuffled game deals the first PAIR_SLOTS.length of a shuffle onto the pair slots, so 8 of 11 play.
 * This order is the shuffle's starting order (append new types; keep it stable).
 */
export const BOARD_TYPES: TypeId[] = [
  'grass', 'fire', 'water', 'electric', 'ground', 'fighting', 'dark', 'psychic',
  'ghost', 'fairy', 'poison',
];

const line = (...forms: [string, number][]): Form[] => forms.map(([name, dex]) => ({ name, dex }));

/**
 * Full 3-stage evolution lines per type. Each creature has exactly one type in this game:
 * the pool it is listed under. Pools may differ in size (2 or more lines each).
 */
export const POKEMON_POOLS: Record<TypeId, Form[][]> = {
  grass: [
    line(['Bulbasaur', 1], ['Ivysaur', 2], ['Venusaur', 3]),
    line(['Chikorita', 152], ['Bayleef', 153], ['Meganium', 154]),
    line(['Treecko', 252], ['Grovyle', 253], ['Sceptile', 254]),
    line(['Turtwig', 387], ['Grotle', 388], ['Torterra', 389]),
    line(['Snivy', 495], ['Servine', 496], ['Serperior', 497]),
    line(['Oddish', 43], ['Gloom', 44], ['Vileplume', 45]),
  ],
  fire: [
    line(['Charmander', 4], ['Charmeleon', 5], ['Charizard', 6]),
    line(['Cyndaquil', 155], ['Quilava', 156], ['Typhlosion', 157]),
    line(['Torchic', 255], ['Combusken', 256], ['Blaziken', 257]),
    line(['Chimchar', 390], ['Monferno', 391], ['Infernape', 392]),
    line(['Tepig', 498], ['Pignite', 499], ['Emboar', 500]),
    line(['Fennekin', 653], ['Braixen', 654], ['Delphox', 655]),
  ],
  water: [
    line(['Squirtle', 7], ['Wartortle', 8], ['Blastoise', 9]),
    line(['Totodile', 158], ['Croconaw', 159], ['Feraligatr', 160]),
    line(['Mudkip', 258], ['Marshtomp', 259], ['Swampert', 260]),
    line(['Piplup', 393], ['Prinplup', 394], ['Empoleon', 395]),
    line(['Oshawott', 501], ['Dewott', 502], ['Samurott', 503]),
    line(['Froakie', 656], ['Frogadier', 657], ['Greninja', 658]),
  ],
  electric: [
    line(['Pichu', 172], ['Pikachu', 25], ['Raichu', 26]),
    line(['Mareep', 179], ['Flaaffy', 180], ['Ampharos', 181]),
    line(['Shinx', 403], ['Luxio', 404], ['Luxray', 405]),
    line(['Magnemite', 81], ['Magneton', 82], ['Magnezone', 462]),
    line(['Elekid', 239], ['Electabuzz', 125], ['Electivire', 466]),
    line(['Tynamo', 602], ['Eelektrik', 603], ['Eelektross', 604]),
  ],
  ground: [
    line(['Trapinch', 328], ['Vibrava', 329], ['Flygon', 330]),
    line(['Gible', 443], ['Gabite', 444], ['Garchomp', 445]),
    line(['Geodude', 74], ['Graveler', 75], ['Golem', 76]),
    line(['Swinub', 220], ['Piloswine', 221], ['Mamoswine', 473]),
    line(['Rhyhorn', 111], ['Rhydon', 112], ['Rhyperior', 464]),
  ],
  fighting: [
    line(['Machop', 66], ['Machoke', 67], ['Machamp', 68]),
    line(['Timburr', 532], ['Gurdurr', 533], ['Conkeldurr', 534]),
    line(['Mankey', 56], ['Primeape', 57], ['Annihilape', 979]),
    line(['Jangmo-o', 782], ['Hakamo-o', 783], ['Kommo-o', 784]),
  ],
  dark: [
    line(['Sandile', 551], ['Krokorok', 552], ['Krookodile', 553]),
    line(['Deino', 633], ['Zweilous', 634], ['Hydreigon', 635]),
    line(['Pawniard', 624], ['Bisharp', 625], ['Kingambit', 983]),
    line(['Impidimp', 859], ['Morgrem', 860], ['Grimmsnarl', 861]),
    line(['Larvitar', 246], ['Pupitar', 247], ['Tyranitar', 248]),
  ],
  psychic: [
    line(['Abra', 63], ['Kadabra', 64], ['Alakazam', 65]),
    line(['Ralts', 280], ['Kirlia', 281], ['Gardevoir', 282]),
    line(['Beldum', 374], ['Metang', 375], ['Metagross', 376]),
    line(['Solosis', 577], ['Duosion', 578], ['Reuniclus', 579]),
    line(['Gothita', 574], ['Gothorita', 575], ['Gothitelle', 576]),
    line(['Hatenna', 856], ['Hattrem', 857], ['Hatterene', 858]),
  ],
  ghost: [
    line(['Gastly', 92], ['Haunter', 93], ['Gengar', 94]),
    line(['Duskull', 355], ['Dusclops', 356], ['Dusknoir', 477]),
    line(['Litwick', 607], ['Lampent', 608], ['Chandelure', 609]),
    line(['Honedge', 679], ['Doublade', 680], ['Aegislash', 681]),
    line(['Dreepy', 885], ['Drakloak', 886], ['Dragapult', 887]),
  ],
  fairy: [
    line(['Cleffa', 173], ['Clefairy', 35], ['Clefable', 36]),
    line(['Togepi', 175], ['Togetic', 176], ['Togekiss', 468]),
    line(['Flabébé', 669], ['Floette', 670], ['Florges', 671]),
    line(['Azurill', 298], ['Marill', 183], ['Azumarill', 184]),
  ],
  poison: [
    line(['Nidoran♂', 32], ['Nidorino', 33], ['Nidoking', 34]),
    line(['Nidoran♀', 29], ['Nidorina', 30], ['Nidoqueen', 31]),
    line(['Zubat', 41], ['Golbat', 42], ['Crobat', 169]),
    line(['Weedle', 13], ['Kakuna', 14], ['Beedrill', 15]),
    line(['Venipede', 543], ['Whirlipede', 544], ['Scolipede', 545]),
  ],
  normal: [],
};

/** Legendaries (no evolution, one type each). A shuffled board uses 4 of different types. */
export const LEGENDARY_POOL: (Form & { type: TypeId })[] = [
  { name: 'Moltres', dex: 146, type: 'fire' },
  { name: 'Entei', dex: 244, type: 'fire' },
  { name: 'Ho-Oh', dex: 250, type: 'fire' },
  { name: 'Zapdos', dex: 145, type: 'electric' },
  { name: 'Raikou', dex: 243, type: 'electric' },
  { name: 'Kyogre', dex: 382, type: 'water' },
  { name: 'Suicune', dex: 245, type: 'water' },
  { name: 'Mewtwo', dex: 150, type: 'psychic' },
  { name: 'Lugia', dex: 249, type: 'psychic' },
  { name: 'Celebi', dex: 251, type: 'grass' },
  { name: 'Groudon', dex: 383, type: 'ground' },
  { name: 'Darkrai', dex: 491, type: 'dark' },
  { name: 'Terrakion', dex: 639, type: 'fighting' },
  { name: 'Giratina', dex: 487, type: 'ghost' },
  { name: 'Xerneas', dex: 716, type: 'fairy' },
  { name: 'Eternatus', dex: 890, type: 'poison' },
];

/** Wild Encounter card text, index-aligned with CONFIG.cards (the effects). */
export const CARD_TEXT: string[] = [
  'You found a Nugget!',
  'Professor Oak sends a gift.',
  'You won a Pokémon contest.',
  'You dropped your wallet in tall grass.',
  'Your bike needs repairs.',
  'Rare Candy!',
  'You used Fly.',
  'Bike shortcut.',
  'Lost in a cave.',
  'Team Rocket caught you!',
  'Escape Rope.',
  "It's your birthday.",
  'A hiker hands you a Great Ball.',
  'Something shiny in the tall grass!',
];

// ── Balls ────────────────────────────────────────────────────────────────────

export type BallKind = 'poke' | 'great' | 'ultra';
export type ThrowBall = BallKind | 'master';

/** Ball display data (icon colors from the brief). Costs and powers are in config.ts. */
export const BALLS: Record<ThrowBall, { name: string; top: string; accent: string; hint: string }> = {
  poke: { name: 'Poké Ball', top: '#E3350D', accent: '#E3350D', hint: 'Best for cheap Pokémon' },
  great: { name: 'Great Ball', top: '#3B6FE0', accent: '#E3350D', hint: 'Solid all-rounder' },
  ultra: { name: 'Ultra Ball', top: '#22252B', accent: '#F2C200', hint: 'For the expensive ones' },
  master: { name: 'Master Ball', top: '#7B3FC4', accent: '#F06CB4', hint: 'Always catches' },
};
/** Shop order. */
export const SHOP_BALLS: BallKind[] = ['poke', 'great', 'ultra'];

// ── Players ──────────────────────────────────────────────────────────────────

export const PLAYER_COLORS = ['#D42E0A', '#3B4CCA', '#1F7F45', '#F2A900'];
/** Colors used by saves from before the redesign, index-aligned with PLAYER_COLORS. */
export const LEGACY_PLAYER_COLORS = ['#E3350D', '#3B4CCA', '#2E9E5B', '#F2A900'];
export const PLAYER_COLOR_NAMES = ['Red', 'Blue', 'Green', 'Gold'];
