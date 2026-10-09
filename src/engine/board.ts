// Board generation: the fixed skeleton and prices stay, creatures and types shuffle.
// Pure and deterministic: all randomness comes from the seeded RNG state passed in.

import {
  BOARD_TYPES,
  CLASSIC_BOARD,
  LEGENDARY_POOL,
  LEGENDARY_SLOTS,
  PAIR_SLOTS,
  POKEMON_POOLS,
  type SlotId,
} from '../data/theme';
import { shuffle } from './rng';
import type { BoardMode, BoardTile, GameState } from './types';

const slotOfTile = (i: number): SlotId | undefined => PAIR_SLOTS.find((s) => s.tiles.includes(i))?.id;

const isCreatureKind = (t: BoardTile) => t.kind === 'pokemon' || t.kind === 'legendary';

/** Today's fixed board, tile for tile (plus pair-slot ids). Does not use randomness. */
export function classicBoard(): BoardTile[] {
  return CLASSIC_BOARD.map((t, i) => {
    const tile: BoardTile = { ...t, forms: t.forms?.map((f) => ({ ...f })) };
    if (t.kind === 'pokemon') tile.slot = slotOfTile(i);
    return tile;
  });
}

/**
 * Builds a board. 'classic' returns the fixed board and leaves the RNG untouched.
 * 'shuffled', in this order: shuffle all board types and deal the first 8 onto pair slots A-H; pick 2 different lines
 * per slot (lower tile index first); deal 4 legendaries of 4 different types onto the
 * legendary slots in pick order; keep every fixed tile from the skeleton.
 */
export function generateBoard(rng: number, mode: BoardMode): { board: BoardTile[]; rng: number } {
  const board = classicBoard(); // fixed tiles come from the skeleton; creature slots get overwritten
  if (mode === 'classic') return { board, rng };

  const h = { rng };

  // 1. Shuffle every board type; the first PAIR_SLOTS.length (8 of 11) go to slots A..H, the rest sit out.
  const types = shuffle(h, [...BOARD_TYPES]);
  if (types.length < PAIR_SLOTS.length) throw new Error('Not enough board types for the pair slots');

  // 2. Two different lines per slot.
  PAIR_SLOTS.forEach((slot, k) => {
    const type = types[k];
    const pool = POKEMON_POOLS[type];
    if (pool.length < 2) throw new Error(`Pool for ${type} needs at least 2 lines`);
    const picks = shuffle(h, pool.map((_, n) => n)).slice(0, 2);
    const tiles = [...slot.tiles].sort((a, b) => a - b);
    tiles.forEach((tileIndex, j) => {
      const forms = pool[picks[j]].map((f) => ({ ...f }));
      board[tileIndex] = { kind: 'pokemon', name: forms[0].name, type, forms, slot: slot.id };
    });
  });

  // 3. Legendaries: shuffled pool, skipping types already taken, until every slot is filled.
  const order = shuffle(h, LEGENDARY_POOL.map((_, n) => n));
  const used = new Set<string>();
  const chosen: (typeof LEGENDARY_POOL)[number][] = [];
  for (const n of order) {
    const l = LEGENDARY_POOL[n];
    if (used.has(l.type)) continue;
    used.add(l.type);
    chosen.push(l);
    if (chosen.length === LEGENDARY_SLOTS.length) break;
  }
  if (chosen.length < LEGENDARY_SLOTS.length) throw new Error('Legendary pool needs more distinct types');
  LEGENDARY_SLOTS.forEach((tileIndex, k) => {
    const l = chosen[k];
    board[tileIndex] = { kind: 'legendary', name: l.name, type: l.type, forms: [{ name: l.name, dex: l.dex }] };
  });

  // 4. Fixed tiles are already in place from the skeleton.
  return { board, rng: h.rng };
}

/** Save migration: games saved before boards existed get the classic board. */
export function withBoard(s: GameState): GameState {
  if (Array.isArray(s.board) && s.board.length === CLASSIC_BOARD.length) return s;
  return { ...s, board: classicBoard(), boardMode: 'classic' };
}

/** Sanity checks used by tests: returns a list of problems (empty = valid). */
export function validateBoard(board: BoardTile[]): string[] {
  const problems: string[] = [];
  if (board.length !== CLASSIC_BOARD.length) problems.push('wrong length');
  CLASSIC_BOARD.forEach((t, i) => {
    if (!isCreatureKind(t) && JSON.stringify(board[i]) !== JSON.stringify(t)) problems.push(`fixed tile ${i} changed`);
  });
  const slotTypes = new Set<string>();
  for (const slot of PAIR_SLOTS) {
    const [a, b] = slot.tiles.map((i) => board[i]);
    if (a.kind !== 'pokemon' || b.kind !== 'pokemon') problems.push(`slot ${slot.id} not creatures`);
    if (a.type !== b.type) problems.push(`slot ${slot.id} mixed types`);
    if (a.forms?.[0].dex === b.forms?.[0].dex) problems.push(`slot ${slot.id} duplicate species`);
    if (a.slot !== slot.id || b.slot !== slot.id) problems.push(`slot ${slot.id} ids wrong`);
    if (a.forms?.length !== 3 || b.forms?.length !== 3) problems.push(`slot ${slot.id} needs 3-stage lines`);
    slotTypes.add(a.type!);
  }
  if (slotTypes.size !== PAIR_SLOTS.length) problems.push('pair slot types not distinct');
  const legendTypes = new Set(LEGENDARY_SLOTS.map((i) => board[i].type));
  if (LEGENDARY_SLOTS.some((i) => board[i].kind !== 'legendary')) problems.push('legendary slot not legendary');
  if (legendTypes.size !== LEGENDARY_SLOTS.length) problems.push('legendary types not distinct');
  return problems;
}

/** Save migration: games saved before the ball system get empty bags (no starting balls mid-game). */
export function withBalls(s: GameState): GameState {
  const needsBalls = s.players.some((p) => !p.balls);
  if (!needsBalls && typeof s.shopClosed === 'boolean' && s.lastThrow !== undefined) return s;
  return {
    ...s,
    players: s.players.map((p) => (p.balls ? p : { ...p, balls: { poke: 0, great: 0, ultra: 0 } })),
    shopClosed: s.shopClosed ?? false,
    shopBuys: s.shopBuys ?? 0,
    lastThrow: s.lastThrow ?? null,
  };
}

/** Save migration: games saved before trading have no offer pending and no trade history. */
export function withTrades(s: GameState): GameState {
  if (s.tradeDeclines !== undefined && s.pendingTrade !== undefined) return s;
  return {
    ...s,
    pendingTrade: s.pendingTrade ?? null,
    tradeOffers: s.tradeOffers ?? 0,
    lastTrade: s.lastTrade ?? null,
    tradeDeclines: s.tradeDeclines ?? [],
  };
}

/** Every save migration, oldest first. */
export function migrateSave(s: GameState): GameState {
  return withTrades(withBalls(withBoard(s)));
}
