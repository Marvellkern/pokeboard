// Trades: applying an accepted offer, and what an offer would do (tradeEffects). Validation lives in
// selectors.ts (tradeCheck) so isLegal can use it. No randomness anywhere here.

import { CONFIG } from '../data/config';
import type { TypeId } from '../data/theme';
import { feeAt, isLegendary, legendaryCount, levelCost, ownsPair, pairPartner, tileType } from './selectors';
import type { GameState, PlayerId, TradeOffer, TradeSide } from './types';

/** An offer with its proposer. */
export type Trade = TradeOffer & { from: PlayerId };

/** A creature kept by `owner` that dropped to the set-rule cap because its pair was broken. */
export interface PairDrop {
  owner: PlayerId;
  tile: number;
  fromLevel: number;
  toLevel: number;
}

/** Tiles sorted, so the same offer always looks the same (saves, logs, the bots' no-repeat rule). */
export function normalizeOffer(o: TradeOffer): TradeOffer {
  const side = (x: TradeSide): TradeSide => ({ tiles: [...x.tiles].sort((a, b) => a - b), money: x.money });
  return { to: o.to, give: side(o.give), receive: side(o.receive) };
}

export function sameOffer(a: TradeOffer, b: TradeOffer): boolean {
  return JSON.stringify(normalizeOffer(a)) === JSON.stringify(normalizeOffer(b));
}

/**
 * Applies a trade to a draft state (mutates it): creatures change owner and reset to the start
 * level, money moves at face value, and any creature left above the set-rule cap without its pair
 * drops to the cap. Returns those drops (for the log).
 */
export function applyTrade(s: GameState, t: Trade): PairDrop[] {
  const from = s.players[t.from];
  const to = s.players[t.to];
  const traded = new Set([...t.give.tiles, ...t.receive.tiles]);
  for (const i of t.give.tiles) s.tiles[i] = { owner: t.to, level: CONFIG.startLevel };
  for (const i of t.receive.tiles) s.tiles[i] = { owner: t.from, level: CONFIG.startLevel };
  from.cash += t.receive.money - t.give.money;
  to.cash += t.give.money - t.receive.money;

  const drops: PairDrop[] = [];
  s.tiles.forEach((tile, i) => {
    if (traded.has(i) || tile.owner === null || (tile.owner !== t.from && tile.owner !== t.to)) return;
    if (tile.level > CONFIG.setRuleCap && !ownsPair(s, tile.owner, i)) {
      drops.push({ owner: tile.owner, tile: i, fromLevel: tile.level, toLevel: CONFIG.setRuleCap });
      tile.level = CONFIG.setRuleCap;
    }
  });
  return drops;
}

/** The state after a trade, without touching `s` (for previews and the bots). */
export function afterTrade(s: GameState, t: Trade): GameState {
  const draft: GameState = { ...s, tiles: s.tiles.map((x) => ({ ...x })), players: s.players.map((p) => ({ ...p })) };
  applyTrade(draft, t);
  return draft;
}

export type TradeEffect =
  /** A traded creature goes back to level 1; its owner before the trade loses what its levels cost. */
  | { kind: 'reset'; player: PlayerId; tile: number; fromLevel: number; lost: number }
  /** `player` keeps `tile` but loses its partner; it may drop to the set-rule cap. */
  | { kind: 'pairBroken'; player: PlayerId; tile: number; type: TypeId; fromLevel: number; toLevel: number; lost: number }
  | { kind: 'pairCompleted'; player: PlayerId; type: TypeId; tiles: [number, number] }
  /** Fee each of `player`'s legendaries charges, before and after. */
  | { kind: 'legendaryFee'; player: PlayerId; before: number; after: number };

/** Every consequence of an offer, for both players. The UI and the bots both read this. */
export function tradeEffects(s: GameState, offer: TradeOffer, from: PlayerId = s.current): TradeEffect[] {
  const t: Trade = { ...offer, from };
  const after = afterTrade(s, t);
  const out: TradeEffect[] = [];
  const players = [t.from, t.to];

  for (const i of [...t.give.tiles, ...t.receive.tiles]) {
    const level = s.tiles[i].level;
    if (level > CONFIG.startLevel && !isLegendary(s, i)) {
      out.push({ kind: 'reset', player: s.tiles[i].owner!, tile: i, fromLevel: level, lost: (level - CONFIG.startLevel) * levelCost(s, i) });
    }
  }

  // Each pair slot once (from its lower tile).
  s.board.forEach((_, i) => {
    const j = pairPartner(s, i);
    if (j === null || j < i) return;
    for (const pid of players) {
      const had = ownsPair(s, pid, i);
      const has = ownsPair(after, pid, i);
      if (had && !has) {
        const kept = after.tiles[i].owner === pid ? i : after.tiles[j].owner === pid ? j : null;
        if (kept !== null) {
          const fromLevel = s.tiles[kept].level;
          const toLevel = after.tiles[kept].level;
          out.push({ kind: 'pairBroken', player: pid, tile: kept, type: tileType(s, i), fromLevel, toLevel, lost: (fromLevel - toLevel) * levelCost(s, kept) });
        }
      } else if (!had && has) {
        out.push({ kind: 'pairCompleted', player: pid, type: tileType(s, i), tiles: [i, j] });
      }
    }
  });

  const legendFee = (st: GameState, pid: PlayerId) => {
    const n = legendaryCount(st, pid);
    const anyLegend = st.board.findIndex((_, i) => isLegendary(st, i));
    return n > 0 && anyLegend >= 0 ? feeAt(st, anyLegend, 1, n) : 0;
  };
  for (const pid of players) {
    if (legendaryCount(s, pid) === legendaryCount(after, pid)) continue;
    out.push({ kind: 'legendaryFee', player: pid, before: legendFee(s, pid), after: legendFee(after, pid) });
  }
  return out;
}

type Sides = { give: TradeSide; receive: TradeSide };

/** One difference between two versions of a proposal, from one player's side. */
export type TradeChange =
  | { kind: 'added'; side: 'give' | 'receive'; tile: number }
  | { kind: 'removed'; side: 'give' | 'receive'; tile: number }
  | { kind: 'money'; side: 'give' | 'receive'; before: number; after: number };

/**
 * What changed from `previous` to `current` (both seen from the same player's side): creatures added
 * or removed on either side, and money before and after. The answer screen's "What changed" box reads this.
 */
export function tradeChanges(previous: Sides, current: Sides): TradeChange[] {
  const out: TradeChange[] = [];
  for (const side of ['give', 'receive'] as const) {
    const before = previous[side];
    const now = current[side];
    for (const tile of now.tiles) if (!before.tiles.includes(tile)) out.push({ kind: 'added', side, tile });
    for (const tile of before.tiles) if (!now.tiles.includes(tile)) out.push({ kind: 'removed', side, tile });
    if (before.money !== now.money) out.push({ kind: 'money', side, before: before.money, after: now.money });
  }
  return out;
}
