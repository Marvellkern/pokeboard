import { useState } from 'react';
import type { GameState, PlayerId } from '../../engine/types';
import { EventRow, FILTERS, eventMatches, type EventFilter } from './EventRow';

/** Newest-first event list with optional filters. */
export function EventList({ game, filter = 'all', pid = null, max }: { game: GameState; filter?: EventFilter; pid?: PlayerId | null; max?: number }) {
  const ks: number[] = [];
  for (let k = game.events.length - 1; k >= 0 && (max === undefined || ks.length < max); k--) {
    if (eventMatches(game.events, k, filter, pid)) ks.push(k);
  }
  if (game.events.length <= 1) return <p className="px-1.5 py-2 text-[14px] font-bold text-ink-soft">Nothing yet. Roll the dice!</p>;
  if (!ks.length) return <p className="px-1.5 py-2 text-[14px] font-bold text-ink-soft">Nothing matches this filter.</p>;
  return (
    <ol className="flex flex-col gap-0.5">
      {ks.map((k) => (
        <EventRow key={game.events[k].id} game={game} k={k} />
      ))}
    </ol>
  );
}

/** Filter chips: by type, and by player. */
export function EventFilters({
  game,
  filter,
  setFilter,
  pid,
  setPid,
}: {
  game: GameState;
  filter: EventFilter;
  setFilter: (f: EventFilter) => void;
  pid: PlayerId | null;
  setPid: (p: PlayerId | null) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show events">
        {FILTERS.map((f) => (
          <button key={f.id} className={`btn btn-sm ${filter === f.id ? 'btn-yellow' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[14px] font-extrabold">
        Player
        <select
          className="h-9 min-w-0 flex-1 rounded-xl border-[3px] border-ink bg-white px-2 font-bold"
          value={pid ?? ''}
          onChange={(e) => setPid(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">Everyone</option>
          {game.players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** The live game log in the side panel, closed until opened. */
export function GameLogPanel({ game }: { game: GameState }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [pid, setPid] = useState<PlayerId | null>(null);
  return (
    <section className="card px-4 py-3" aria-label="Game log">
      <button className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <h2 className="font-display text-[17px] font-semibold">Game log</h2>
        <span className="text-[13px] font-extrabold text-ink-soft">
          {Math.max(0, game.events.length - 1)} events {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <EventFilters game={game} filter={filter} setFilter={setFilter} pid={pid} setPid={setPid} />
          <div className="max-h-[340px] overflow-y-auto">
            <EventList game={game} filter={filter} pid={pid} />
          </div>
        </div>
      )}
    </section>
  );
}
