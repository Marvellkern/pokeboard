import { describe, expect, it } from 'vitest';
import { CLASSIC_BOARD, LEGENDARY_SLOTS, PAIR_SLOTS, POKEMON_POOLS, BOARD_TYPES } from '../../data/theme';
import { classicBoard, generateBoard, validateBoard, withBoard } from '../board';
import { chooseAction } from '../bot';
import { createGame, reduce } from '../reducer';
import { seedToState } from '../rng';
import { formAtLevel, isLegal, levelUpCheck, pairPartner, tileForm, tilePrice } from '../selectors';
import type { BoardMode, GameState } from '../types';

const SLOT_PRICES = [100, 140, 180, 220, 260, 300, 350, 400];
const SEEDS = Array.from({ length: 1000 }, (_, i) => i * 7919 + 1);

function newGame(seed: number, boardMode: BoardMode, players = 4): GameState {
  return createGame(
    {
      players: Array.from({ length: players }, (_, i) => ({ name: `B${i}`, color: '#000', isBot: true, starter: i })),
      roundLimit: 30,
      boardMode,
    },
    seed,
  );
}

const strip = (b: ReturnType<typeof classicBoard>) => JSON.stringify(b.map(({ slot: _slot, ...t }) => t));

describe('classic board', () => {
  it('matches the old hardcoded board tile for tile and uses no randomness', () => {
    const { board, rng } = generateBoard(seedToState(42), 'classic');
    expect(strip(board)).toBe(JSON.stringify(CLASSIC_BOARD));
    expect(rng).toBe(seedToState(42));
    expect(validateBoard(board)).toEqual([]);
  });

  it('is the engine default, so existing games deal exactly as before', () => {
    const s = createGame({ players: [{ name: 'a', color: '#000', isBot: true, starter: 0 }, { name: 'b', color: '#000', isBot: true, starter: 1 }], roundLimit: 20 }, 9);
    expect(s.boardMode).toBe('classic');
    expect(strip(s.board)).toBe(JSON.stringify(CLASSIC_BOARD));
  });
});

describe('shuffled board generator', () => {
  it('same seed gives the identical board twice; different seeds give different boards', () => {
    const a = generateBoard(seedToState(123), 'shuffled');
    const b = generateBoard(seedToState(123), 'shuffled');
    expect(a).toEqual(b);
    const distinct = new Set(SEEDS.slice(0, 200).map((s) => JSON.stringify(generateBoard(seedToState(s), 'shuffled').board)));
    expect(distinct.size).toBeGreaterThan(195);
  });

  it(`every board is valid over ${SEEDS.length} seeds`, () => {
    for (const seed of SEEDS) {
      const s = newGame(seed, 'shuffled');
      const problems = validateBoard(s.board);
      expect(problems, `seed ${seed}: ${problems.join(', ')}`).toEqual([]);

      // 8 distinct types on the pair slots, 2 different species per pair, prices by slot.
      const types = PAIR_SLOTS.map((slot) => s.board[slot.tiles[0]].type);
      expect(new Set(types).size).toBe(8);
      PAIR_SLOTS.forEach((slot, k) => {
        const [lo, hi] = slot.tiles;
        expect(s.board[lo].forms![0].dex).not.toBe(s.board[hi].forms![0].dex);
        expect(tilePrice(s, lo)).toBe(SLOT_PRICES[k]);
        expect(tilePrice(s, hi)).toBe(SLOT_PRICES[k]);
        expect(pairPartner(s, lo)).toBe(hi);
        expect(pairPartner(s, hi)).toBe(lo);
      });

      // 4 legendaries of 4 different types, price unchanged.
      expect(new Set(LEGENDARY_SLOTS.map((i) => s.board[i].type)).size).toBe(4);
      LEGENDARY_SLOTS.forEach((i) => expect(tilePrice(s, i)).toBe(200));

      // Fixed tiles in their fixed positions.
      CLASSIC_BOARD.forEach((t, i) => {
        if (t.kind !== 'pokemon' && t.kind !== 'legendary') expect(s.board[i]).toEqual(t);
      });
    }
  });

  it('every species comes from the pool of the type it is shown as', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const { board } = generateBoard(seedToState(seed), 'shuffled');
      for (const slot of PAIR_SLOTS) {
        for (const i of slot.tiles) {
          const t = board[i];
          expect(POKEMON_POOLS[t.type!].some((line) => line[0].dex === t.forms![0].dex)).toBe(true);
        }
      }
    }
  });

  it('every pool used on the board has at least 2 full 3-stage lines', () => {
    for (const type of BOARD_TYPES) {
      expect(POKEMON_POOLS[type].length).toBeGreaterThanOrEqual(2);
      POKEMON_POOLS[type].forEach((line) => expect(line.length).toBe(3));
    }
  });

  it('shuffles over many games: every type lands on every price slot', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { board } = generateBoard(seedToState(seed), 'shuffled');
      PAIR_SLOTS.forEach((slot) => seen.add(`${slot.id}:${board[slot.tiles[0]].type}`));
    }
    expect(seen.size).toBe(PAIR_SLOTS.length * BOARD_TYPES.length);
  });
});

describe('rules read the game board', () => {
  it('set rule uses the pair slot; evolution names come from the board', () => {
    let s = newGame(5, 'shuffled');
    const [a, b] = PAIR_SLOTS[3].tiles;
    s = { ...s, tiles: s.tiles.map((t, i) => (i === a ? { owner: 0, level: 2 } : t)) };
    expect(levelUpCheck(s, 0, { kind: 'tile', tile: a }).reason).toBe('needPair');
    s = { ...s, tiles: s.tiles.map((t, i) => (i === b ? { owner: 0, level: 1 } : t)) };
    expect(levelUpCheck(s, 0, { kind: 'tile', tile: a }).ok).toBe(true);

    const forms = s.board[a].forms!;
    expect(formAtLevel(s, a, 1)).toEqual(forms[0]);
    expect(formAtLevel(s, a, 3)).toEqual(forms[1]);
    expect(formAtLevel(s, a, 5)).toEqual(forms[2]);
    s = { ...s, tiles: s.tiles.map((t, i) => (i === a ? { owner: 0, level: 5 } : t)) };
    expect(tileForm(s, a)).toEqual(forms[2]);
  });

  it('the board survives a save/load round trip and never changes during play', () => {
    let s = newGame(77, 'shuffled');
    const board = JSON.stringify(s.board);
    for (let i = 0; i < 400 && s.phase !== 'gameOver'; i++) s = reduce(s, chooseAction(s));
    expect(JSON.stringify(s.board)).toBe(board);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('full bot games finish on shuffled boards', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      let s = newGame(seed, 'shuffled');
      for (let i = 0; i < 20000 && s.phase !== 'gameOver'; i++) {
        const a = chooseAction(s);
        expect(isLegal(s, a)).toBe(true);
        s = reduce(s, a);
      }
      expect(s.phase).toBe('gameOver');
    }
  });
});

describe('save migration', () => {
  it('an old save without a board gets the classic board and keeps playing', () => {
    const fresh = newGame(11, 'classic');
    let s = fresh;
    for (let i = 0; i < 50; i++) s = reduce(s, chooseAction(s));
    const old = JSON.parse(JSON.stringify(s));
    delete old.board;
    delete old.boardMode;

    let loaded = withBoard(old as GameState);
    expect(loaded.boardMode).toBe('classic');
    expect(strip(loaded.board)).toBe(JSON.stringify(CLASSIC_BOARD));
    // Plays on identically to the game that never lost its board.
    let ref = s;
    for (let i = 0; i < 200 && loaded.phase !== 'gameOver'; i++) {
      const a = chooseAction(loaded);
      loaded = reduce(loaded, a);
      ref = reduce(ref, a);
    }
    expect(loaded).toEqual(ref);
  });

  it('leaves saves that already have a board alone', () => {
    const s = newGame(3, 'shuffled');
    expect(withBoard(s)).toBe(s);
  });
});

describe('drawing 8 of the board types', () => {
  it('every board deals 8 distinct types from the full list, and each type appears in about 8/11 of games', () => {
    const appear: Record<string, number> = {};
    for (const seed of SEEDS) {
      const { board } = generateBoard(seedToState(seed), 'shuffled');
      const types = PAIR_SLOTS.map((slot) => board[slot.tiles[0]].type!);
      expect(new Set(types).size).toBe(PAIR_SLOTS.length);
      for (const t of types) {
        expect(BOARD_TYPES).toContain(t);
        appear[t] = (appear[t] ?? 0) + 1;
      }
    }
    const expected = PAIR_SLOTS.length / BOARD_TYPES.length;
    for (const t of BOARD_TYPES) {
      const rate = (appear[t] ?? 0) / SEEDS.length;
      expect(rate, `${t} appears ${rate}`).toBeGreaterThan(expected - 0.06);
      expect(rate, `${t} appears ${rate}`).toBeLessThan(expected + 0.06);
    }
  });

  it('a legendary may appear without a pair of its type, and legendaries stay 4 distinct types', () => {
    let orphan = 0;
    for (const seed of SEEDS) {
      const { board } = generateBoard(seedToState(seed), 'shuffled');
      const pairTypes = new Set(PAIR_SLOTS.map((slot) => board[slot.tiles[0]].type));
      const legends = LEGENDARY_SLOTS.map((i) => board[i].type);
      expect(new Set(legends).size).toBe(LEGENDARY_SLOTS.length);
      if (legends.some((t) => !pairTypes.has(t))) orphan++;
    }
    expect(orphan).toBeGreaterThan(0);
  });
});
