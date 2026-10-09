// Compact encoding of the event log for the network (online play rewrites the whole state on every
// move, so the log is sent as small arrays, with cash and net worth stored as changes from the
// previous event). Plain objects everywhere else.

import type { EventMeta, GameEvent, GameEventType } from './types';

/** [id, turn, round, player, type, text, cash change, worth change, meta?]; a change is null when nothing moved. */
export type PackedEvent = [number, number, number, number | null, GameEventType, string, number[] | null, number[] | null, EventMeta?];

const diff = (now: number[], before: number[] | null): number[] | null => {
  if (!before) return now;
  const d = now.map((v, i) => v - (before[i] ?? 0));
  return d.some((v) => v !== 0) ? d : null;
};
const apply = (change: number[] | null, before: number[] | null, n: number): number[] =>
  change === null ? (before ?? Array(n).fill(0)) : before ? change.map((v, i) => v + (before[i] ?? 0)) : change;

export function packEvents(events: GameEvent[]): PackedEvent[] {
  return events.map((e, k) => {
    const prev = k > 0 ? events[k - 1] : null;
    const row: PackedEvent = [e.id, e.turn, e.round, e.player, e.type, e.text, diff(e.cash, prev && prev.cash), diff(e.worth, prev && prev.worth)];
    if (e.meta) row.push(e.meta);
    return row;
  });
}

export function unpackEvents(rows: PackedEvent[], players: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (const [id, turn, round, player, type, text, cash, worth, meta] of rows) {
    const prev = out[out.length - 1] ?? null;
    out.push({
      id,
      turn,
      round,
      player,
      type,
      text,
      cash: apply(cash, prev && prev.cash, players),
      worth: apply(worth, prev && prev.worth, players),
      ...(meta ? { meta } : {}),
    });
  }
  return out;
}
