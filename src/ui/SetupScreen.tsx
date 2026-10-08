import { useState } from 'react';
import { CONFIG } from '../data/config';
import { GAME_TITLE, NEUTRAL_TYPE, PLAYER_COLORS, PLAYER_COLOR_NAMES, SPRITE_CREDIT, STARTERS, WORDS } from '../data/theme';
import type { BoardMode, SetupPlayer } from '../engine/types';
import { useStore } from '../store';
import { Outlined, PlayerName, Render } from './common';
import { textOn } from './format';

const defaultSeats = (): SetupPlayer[] =>
  Array.from({ length: CONFIG.maxPlayers }, (_, i) => ({
    name: i === 0 ? 'Player 1' : `Bot ${i + 1}`,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    isBot: i !== 0,
    starter: i % STARTERS.length,
  }));

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  render = (v) => String(v),
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  render?: (v: T) => string;
}) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <span className="font-display mr-1 text-[17px] font-semibold">{label}</span>
      {options.map((o) => (
        <button
          key={String(o)}
          className={`btn btn-sm min-w-12 ${o === value ? 'btn-yellow' : ''}`}
          aria-pressed={o === value}
          onClick={() => onChange(o)}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export function SetupScreen({ onHome }: { onHome?: () => void }) {
  const saved = useStore((s) => s.saved);
  const start = useStore((s) => s.start);
  const resume = useStore((s) => s.resume);
  const [showForm, setShowForm] = useState(!saved);
  const [count, setCount] = useState(CONFIG.maxPlayers);
  const [seats, setSeats] = useState<SetupPlayer[]>(defaultSeats);
  const [roundLimit, setRoundLimit] = useState(CONFIG.defaultRoundLimit);
  const [boardMode, setBoardMode] = useState<BoardMode>('shuffled');

  const active = seats.slice(0, count);
  const update = (i: number, patch: Partial<SetupPlayer>) =>
    setSeats((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const takenColors = (i: number) => new Set(active.filter((_, j) => j !== i).map((p) => p.color));
  const takenStarters = (i: number) => new Set(active.filter((_, j) => j !== i).map((p) => p.starter));

  const problems: string[] = [];
  if (active.some((p) => !p.name.trim())) problems.push('Every player needs a name.');
  if (new Set(active.map((p) => p.color)).size < count) problems.push('Each player needs a different color.');
  if (new Set(active.map((p) => p.starter)).size < count) problems.push(`Each player needs a different ${WORDS.starter.toLowerCase()}.`);

  const onStart = () => {
    if (problems.length) return;
    start({ players: active.map((p) => ({ ...p, name: p.name.trim() })), roundLimit, boardMode });
  };

  const counts = Array.from({ length: CONFIG.maxPlayers - CONFIG.minPlayers + 1 }, (_, k) => k + CONFIG.minPlayers);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-5 px-4 py-8">
      {onHome && (
        <button className="btn btn-sm on-bg self-start" onClick={onHome}>
          ← Home
        </button>
      )}
      <header className="flex flex-col items-center gap-3 text-center">
        <Outlined as="h1" className="text-[56px] sm:text-[72px]">
          {GAME_TITLE}
        </Outlined>
        <p className="on-glass max-w-lg text-[17px]">
          Catch {WORDS.creatures}, level them up, and win fee battles. Last player standing, or richest when the rounds
          run out, wins.
        </p>
      </header>

      {saved && !showForm && (
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="font-display text-[22px] font-bold">Saved game</h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px]">
            <span>
              Round {saved.round} of {saved.roundLimit}
            </span>
            {saved.players.map((p) => (
              <span key={p.id} className={p.bankrupt ? 'line-through opacity-50' : ''}>
                <PlayerName player={p} />
              </span>
            ))}
          </p>
          <div className="flex flex-wrap gap-3">
            <button className="btn btn-primary btn-lg" onClick={resume}>
              Continue game
            </button>
            <button className="btn btn-lg" onClick={() => setShowForm(true)}>
              New game
            </button>
          </div>
        </section>
      )}

      {showForm && (
        <>
          <section className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
            <Segmented label="Players" options={counts} value={count} onChange={setCount} />
            <Segmented label="Rounds" options={CONFIG.roundLimits} value={roundLimit} onChange={setRoundLimit} />
            <Segmented<BoardMode>
              label="Board"
              options={['shuffled', 'classic']}
              value={boardMode}
              onChange={setBoardMode}
              render={(m) => (m === 'shuffled' ? 'Shuffled' : 'Classic')}
            />
          </section>

          {active.map((seat, i) => (
            <section key={i} className="card flex flex-col gap-4 p-5" style={{ boxShadow: `inset 8px 0 0 ${seat.color}, 0 5px 0 rgba(19,28,63,.3)` }}>
              <div className="flex flex-wrap items-end gap-3 pl-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[13px] font-extrabold text-ink-soft">Seat {i + 1} name</span>
                  <input
                    className="font-display h-12 rounded-2xl border-[3px] border-ink px-3 text-[18px] font-semibold"
                    value={seat.name}
                    maxLength={14}
                    onChange={(e) => update(i, { name: e.target.value })}
                  />
                </label>
                <div className="flex gap-2" role="group" aria-label={`Seat ${i + 1} controller`}>
                  <button
                    className={`btn btn-sm ${!seat.isBot ? 'btn-ink' : ''}`}
                    aria-pressed={!seat.isBot}
                    onClick={() => update(i, { isBot: false })}
                  >
                    Human
                  </button>
                  <button
                    className={`btn btn-sm ${seat.isBot ? 'btn-ink' : ''}`}
                    aria-pressed={seat.isBot}
                    onClick={() => update(i, { isBot: true })}
                  >
                    Bot
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-2" role="group" aria-label={`Seat ${i + 1} color`}>
                <span className="w-16 text-[13px] font-extrabold text-ink-soft">Color</span>
                {PLAYER_COLORS.map((c, k) => {
                  const taken = takenColors(i).has(c);
                  const sel = seat.color === c;
                  return (
                    <button
                      key={c}
                      className="btn btn-sm min-w-12 px-2"
                      style={{ background: c, color: textOn(c), outline: sel ? '3px solid var(--ink)' : undefined, outlineOffset: 3 }}
                      aria-pressed={sel}
                      aria-label={`${PLAYER_COLOR_NAMES[k]}${taken ? ' (taken)' : ''}`}
                      disabled={taken}
                      onClick={() => update(i, { color: c })}
                    >
                      {sel ? '✓' : PLAYER_COLOR_NAMES[k][0]}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3 pl-2" role="group" aria-label={`Seat ${i + 1} ${WORDS.starter}`}>
                <span className="w-16 text-[13px] font-extrabold text-ink-soft">{WORDS.starter}</span>
                {STARTERS.map((f, k) => {
                  const taken = takenStarters(i).has(k);
                  const sel = seat.starter === k;
                  return (
                    <button
                      key={f.dex}
                      className="flex flex-col items-center gap-1 rounded-2xl p-1 disabled:cursor-not-allowed disabled:opacity-35"
                      aria-pressed={sel}
                      aria-label={`${f.name}${taken ? ' (taken)' : ''}`}
                      disabled={taken}
                      onClick={() => update(i, { starter: k })}
                    >
                      <span
                        className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-white"
                        style={{
                          boxShadow: sel
                            ? `inset 0 0 0 5px ${seat.color}, 0 4px 0 var(--ink)`
                            : 'inset 0 0 0 3px var(--ink), 0 4px 0 rgba(19,28,63,.3)',
                          background: sel ? 'var(--yellow)' : '#fff',
                        }}
                      >
                        <Render dex={f.dex} name={f.name} type={NEUTRAL_TYPE} size={56} />
                      </span>
                      <span className="text-[13px] font-extrabold">{f.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {problems.length > 0 && (
            <ul className="card px-5 py-3 text-[15px] font-black text-red" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap justify-center gap-3">
            {saved && (
              <button className="btn btn-lg on-bg" onClick={() => setShowForm(false)}>
                Back
              </button>
            )}
            <button className="btn btn-primary btn-lg on-bg px-10" disabled={problems.length > 0} onClick={onStart}>
              Start game
            </button>
          </div>
          {saved && (
            <p className="on-glass self-center text-center text-[14px]">
              Starting a new game replaces your saved game.
            </p>
          )}
        </>
      )}

      <footer className="on-glass mt-auto self-center text-center text-[13px]">
        A private, non-commercial fan project. {SPRITE_CREDIT}
      </footer>
    </main>
  );
}
