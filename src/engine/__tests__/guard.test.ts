import { describe, expect, it } from 'vitest';
import { createGame, reduce } from '../reducer';
import { actorOf, isLegal, tileFee } from '../selectors';
import type { GameState } from '../types';

const game = (): GameState =>
  createGame({ players: [0, 1].map((i) => ({ name: `P${i + 1}`, color: '#000', isBot: false, starter: i })), roundLimit: 20 }, 5);
const edit = (s: GameState, fn: (d: GameState) => void) => {
  const d = structuredClone(s);
  fn(d);
  return d;
};

describe('acting-player guard', () => {
  it('accepts an action from the seat whose turn it is and rejects it from anyone else', () => {
    const s = game();
    expect(actorOf(s)).toBe(0);
    expect(reduce(s, { type: 'ROLL', by: 1 })).toBe(s); // wrong player: unchanged
    expect(isLegal(s, { type: 'ROLL', by: 1 })).toBe(false);
    expect(reduce(s, { type: 'ROLL', by: 0 })).not.toBe(s);
  });

  it('in a battle, the defender picks the defender\'s moves on its own seat', () => {
    const tile = game().board.findIndex((t) => t.kind === 'pokemon');
    let s = edit(game(), (d) => {
      d.tiles[tile] = { owner: 1, level: 1 };
      d.players[0].position = tile;
      d.phase = 'feeChoice';
      d.pendingTile = tile;
    });
    expect(tileFee(s, tile)).toBeGreaterThan(0);
    s = reduce(s, { type: 'BATTLE', fighter: { kind: 'starter' }, by: 0 });
    expect(s.phase).toBe('battle');
    // Defender (seat 1) moves first, even though it's seat 0's turn.
    expect(actorOf(s)).toBe(1);
    expect(reduce(s, { type: 'MOVE', move: 'tackle', by: 0 })).toBe(s);
    expect(reduce(s, { type: 'MOVE', move: 'tackle', by: 1 })).not.toBe(s);
  });

  it('a grunt\'s move is taken by nobody (null), never by a player seat', () => {
    const ambush = game().board.findIndex((t) => t.kind === 'ambush');
    let s = edit(game(), (d) => {
      d.players[0].position = ambush;
      d.phase = 'ambushChoice';
    });
    s = reduce(s, { type: 'BATTLE', fighter: { kind: 'starter' }, by: 0 });
    expect(actorOf(s)).toBeNull();
    expect(reduce(s, { type: 'MOVE', move: 'tackle', by: 0 })).toBe(s);
    expect(reduce(s, { type: 'MOVE', move: 'tackle', by: null })).not.toBe(s);
  });

  it('actions without `by` behave as before (tests, simulator)', () => {
    const s = game();
    expect(reduce(s, { type: 'ROLL' })).not.toBe(s);
  });
});
