import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../data/config';
import { BATTLE_GRADIENTS, BOARD_TYPES, GRUNTS, NEUTRAL_TYPE, POKEMON_POOLS, TYPES, TYPE_CHART, type TypeId } from '../../data/theme';
import { typeMultiplier } from '../battle';

const ALL = Object.keys(TYPES) as TypeId[];
const { strong, weak, neutral } = CONFIG.typeMultipliers;

describe('type chart', () => {
  it('matches the agreed chart exactly', () => {
    expect(TYPE_CHART).toEqual({
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
    });
  });

  it('strong entries are 1.5×, their reverse 0.5×, everything else 1×', () => {
    for (const a of ALL) {
      for (const d of ALL) {
        const m = typeMultiplier(a, d);
        if (a === NEUTRAL_TYPE || d === NEUTRAL_TYPE) expect(m, `${a}→${d}`).toBe(neutral);
        else if (TYPE_CHART[a].includes(d)) expect(m, `${a}→${d}`).toBe(strong);
        else if (TYPE_CHART[d].includes(a)) expect(m, `${a}→${d}`).toBe(weak);
        else expect(m, `${a}→${d}`).toBe(neutral);
      }
    }
  });

  it('no two types beat each other in both directions, and no type beats itself', () => {
    for (const a of ALL) {
      expect(TYPE_CHART[a]).not.toContain(a);
      for (const d of TYPE_CHART[a]) expect(TYPE_CHART[d], `${a} and ${d} beat each other`).not.toContain(a);
    }
  });

  it('every board type has a counter, a pool of 2+ lines, and its own colors', () => {
    for (const t of BOARD_TYPES) {
      expect(ALL.some((a) => TYPE_CHART[a].includes(t)), `${t} has no counter`).toBe(true);
      expect(POKEMON_POOLS[t].length).toBeGreaterThanOrEqual(2);
      expect(BATTLE_GRADIENTS[t]).toHaveLength(2);
    }
    expect(BOARD_TYPES).toHaveLength(11);
    expect(new Set(BOARD_TYPES.map((t) => TYPES[t].color)).size).toBe(BOARD_TYPES.length);
  });

  it('no creature is both a grunt and catchable', () => {
    const catchable = new Set(Object.values(POKEMON_POOLS).flat(2).map((f) => f.dex));
    for (const g of GRUNTS) expect(catchable.has(g.dex), `${g.name} is catchable`).toBe(false);
  });
});
