// Post-game recap: standings, the winning margin, and key moments, all read from the event log.
// Pure functions. A highlight is only returned when the events support it; nothing is invented.

import { CONFIG } from '../data/config';
import { CURRENCY } from '../data/theme';
import { netWorth, ownedTiles, ranking } from './selectors';
import type { GameEvent, GameState, PlayerId } from './types';

const money = (n: number) => `${CURRENCY}${n.toLocaleString('en-US')}`;

export interface BattleRecord {
  won: number;
  lost: number;
}

/** Battles won and lost per player. A fee battle counts for both the attacker and the defending owner. */
export function battleRecords(s: GameState): BattleRecord[] {
  const out = s.players.map(() => ({ won: 0, lost: 0 }));
  for (const e of s.events) {
    if ((e.type !== 'battle_won' && e.type !== 'battle_lost') || e.player === null) continue;
    const won = e.type === 'battle_won';
    out[e.player][won ? 'won' : 'lost']++;
    const opp = e.meta?.opponent;
    if (opp !== undefined && opp !== null) out[opp][won ? 'lost' : 'won']++;
  }
  return out;
}

export interface Standing {
  pid: PlayerId;
  rank: number;
  worth: number;
  cash: number;
  owned: number;
  battles: BattleRecord;
  bankrupt: boolean;
}

export function standings(s: GameState): Standing[] {
  const records = battleRecords(s);
  return ranking(s).map((pid, k) => ({
    pid,
    rank: k + 1,
    worth: netWorth(s, pid),
    cash: s.players[pid].cash,
    owned: ownedTiles(s, pid).length,
    battles: records[pid],
    bankrupt: s.players[pid].bankrupt,
  }));
}

/** How the game was won: by net worth at the round limit (with the margin over 2nd), or as the last one standing. */
export function winMargin(s: GameState): { winner: PlayerId; runnerUp: PlayerId | null; margin: number; lastStanding: boolean } | null {
  if (s.winner === null) return null;
  const order = ranking(s);
  const lastStanding = s.players.filter((p) => !p.bankrupt).length === 1;
  const runnerUp = order.find((pid) => pid !== s.winner) ?? null;
  const margin = runnerUp === null ? 0 : netWorth(s, s.winner) - netWorth(s, runnerUp);
  return { winner: s.winner, runnerUp, margin, lastStanding };
}

/** How much each player's cash / net worth changed with event k. */
export function eventDelta(events: GameEvent[], k: number, field: 'cash' | 'worth' = 'cash'): number[] {
  const now = events[k][field];
  const before = k > 0 ? events[k - 1][field] : now;
  return now.map((v, i) => v - (before[i] ?? v));
}

export type MomentKind = 'swing' | 'comeback' | 'luckyCatch' | 'battleStar';

export interface KeyMoment {
  kind: MomentKind;
  title: string;
  text: string;
  /** The event it points at, if any. */
  eventId?: number;
}

/** The single event that moved the most net worth for one player. */
function biggestSwing(s: GameState): KeyMoment | null {
  let best: { k: number; amount: number } | null = null;
  s.events.forEach((e, k) => {
    if (k === 0 || e.type === 'game_over') return;
    const amount = Math.max(...eventDelta(s.events, k, 'worth').map(Math.abs));
    if (amount > 0 && (!best || amount > best.amount)) best = { k, amount };
  });
  if (!best) return null;
  const { k, amount } = best as { k: number; amount: number };
  const e = s.events[k];
  // Name the amount unless the sentence already does.
  const amountText = e.text.includes(money(amount)) ? '' : ` (${money(amount)} of net worth)`;
  return { kind: 'swing', title: 'Biggest swing', text: `Round ${e.round}: ${e.text}${amountText}`, eventId: e.id };
}

/** Who is strictly ahead on net worth after event k (null on a tie). */
function leaderAt(e: GameEvent): PlayerId | null {
  const top = Math.max(...e.worth);
  const leaders = e.worth.flatMap((v, i) => (v === top ? [i] : []));
  return leaders.length === 1 ? leaders[0] : null;
}

/**
 * The winner was behind the leader by at least comebackShare × starting money at some point, then
 * took the lead and kept it to the end.
 */
export function comeback(s: GameState): KeyMoment | null {
  const w = s.winner;
  const ev = s.events;
  if (w === null || ev.length < 2) return null;
  // The last event where the winner wasn't strictly ahead; they lead alone from the next one on.
  let last = -1;
  ev.forEach((e, k) => {
    if (leaderAt(e) !== w) last = k;
  });
  if (last === ev.length - 1) return null; // never led alone (e.g. a tie)
  let deficit = 0;
  let deficitAt = -1;
  for (let k = 0; k <= last; k++) {
    const gap = Math.max(...ev[k].worth) - ev[k].worth[w];
    if (gap > deficit) {
      deficit = gap;
      deficitAt = k;
    }
  }
  if (deficitAt < 0 || deficit < CONFIG.recap.comebackShare * CONFIG.startingMoney) return null;
  const behind = ev[deficitAt];
  const took = ev[last + 1];
  const name = s.players[w].name;
  return {
    kind: 'comeback',
    title: 'Comeback',
    text: `${name} was ${money(deficit)} behind in round ${behind.round}, then took the lead for good in round ${took.round}: ${took.text}`,
    eventId: took.id,
  };
}

/** The lowest-odds catch with a carried ball. */
function luckiestCatch(s: GameState): KeyMoment | null {
  let best: GameEvent | null = null;
  for (const e of s.events) {
    const c = e.meta?.chance;
    if (e.type !== 'catch_success' || e.meta?.ball === 'master' || c === undefined || c > CONFIG.recap.luckyCatchMaxChance) continue;
    if (!best || c < best.meta!.chance!) best = e;
  }
  if (!best) return null;
  return { kind: 'luckyCatch', title: 'Luckiest catch', text: `Round ${best.round}: ${best.text}`, eventId: best.id };
}

/** Most battles won, if one player clearly leads. */
function battleStar(s: GameState): KeyMoment | null {
  const rec = battleRecords(s);
  const top = Math.max(...rec.map((r) => r.won));
  const leaders = rec.flatMap((r, i) => (r.won === top ? [i] : []));
  if (top < CONFIG.recap.minBattleWins || leaders.length !== 1) return null;
  const pid = leaders[0];
  const r = rec[pid];
  return {
    kind: 'battleStar',
    title: 'Battle star',
    text: `${s.players[pid].name} won ${r.won} battle${r.won === 1 ? '' : 's'} and lost ${r.lost}.`,
  };
}

/** 0-4 highlights, each only if the game's events support it. */
export function keyMoments(s: GameState): KeyMoment[] {
  return [comeback(s), biggestSwing(s), luckiestCatch(s), battleStar(s)].filter((m): m is KeyMoment => m !== null);
}

/** Lines for the money chart: one point per event that changed someone's cash or net worth (plus the first and last). */
export function chartPoints(events: GameEvent[], field: 'cash' | 'worth'): { k: number; values: number[] }[] {
  const out: { k: number; values: number[] }[] = [];
  events.forEach((e, k) => {
    const changed = k === 0 || k === events.length - 1 || eventDelta(events, k, field).some((d) => d !== 0);
    if (changed) out.push({ k, values: e[field] });
  });
  return out;
}

