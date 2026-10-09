import { useEffect, useMemo, useRef, useState } from 'react';
import { STARTERS, WORDS } from '../../data/theme';
import { keyMoments, standings, winMargin, type KeyMoment } from '../../engine/recap';
import type { GameState, PlayerId } from '../../engine/types';
import { Avatar, Outlined, PlayerChip } from '../common';
import { money, playerColor } from '../format';
import type { SessionButton } from '../session';
import type { EventFilter } from './EventRow';
import { EventFilters, EventList } from './GameLogPanel';
import { MoneyChart } from './MoneyChart';

const CONFETTI = ['var(--yellow)', 'var(--red)', 'var(--event-move)', 'var(--gain)', 'var(--event-card)', 'var(--event-trade)'];

function WinnerBanner({ game }: { game: GameState }) {
  const m = winMargin(game);
  if (!m) return null;
  const w = game.players[m.winner];
  const f = STARTERS[w.starter];
  const worth = standings(game)[0].worth;
  const runner = m.runnerUp !== null ? game.players[m.runnerUp] : null;
  return (
    <section className="card-strong relative overflow-hidden px-4 pt-5 pb-4 text-center" aria-label="Winner">
      <div className="confetti" aria-hidden>
        {Array.from({ length: 18 }, (_, k) => (
          <i
            key={k}
            style={{
              left: `${(k * 37) % 100}%`,
              background: CONFETTI[k % CONFETTI.length],
              animationDelay: `${(k % 6) * 60}ms`,
            }}
          />
        ))}
      </div>
      <div className="recap-bounce flex flex-col items-center gap-2">
        <Avatar player={w} dex={f.dex} name={f.name} size={112} ring={7} />
        <Outlined as="h2" className="text-[38px] leading-tight sm:text-[48px]">
          {w.name} wins!
        </Outlined>
        <p className="text-[16px] font-extrabold">
          Net worth <span className="font-display text-[22px] font-bold">{money(worth)}</span>
        </p>
        <p className="text-[15px] font-bold text-ink-soft">
          {m.lastStanding
            ? `Last player standing after ${game.round} round${game.round === 1 ? '' : 's'}.`
            : runner
              ? m.margin === 0
                ? `Tied with ${runner.name}, winning on seat order.`
                : `${money(m.margin)} ahead of ${runner.name} after ${game.round} rounds.`
              : ''}
        </p>
      </div>
    </section>
  );
}

function Standings({ game }: { game: GameState }) {
  const rows = standings(game);
  return (
    <section className="card px-4 py-3" aria-label="Final standings">
      <h3 className="font-display mb-2 text-[20px] font-bold">Final standings</h3>
      <ol className="flex flex-col gap-2">
        {rows.map((r) => {
          const p = game.players[r.pid];
          return (
            <li
              key={r.pid}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-[3px] border-ink px-3 py-2 ${r.rank === 1 ? 'bg-yellow' : 'bg-white'}`}
            >
              <span className="font-display w-6 text-[20px] font-bold">{r.rank}.</span>
              <PlayerChip player={p} />
              <span className="font-display ml-auto text-[19px] font-bold">{r.bankrupt ? 'Out' : money(r.worth)}</span>
              <span className="basis-full pl-9 text-[13px] font-extrabold text-ink-soft">
                {r.bankrupt ? 'Bankrupt' : `Cash ${money(r.cash)}`} · {r.owned} {WORDS.creatures} · Battles {r.battles.won} won, {r.battles.lost} lost
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[12.5px] font-bold text-ink-soft">Net worth = cash + {WORDS.creatures} at their price + levels bought. It decides the winner.</p>
    </section>
  );
}

function Moments({ moments, onShow }: { moments: KeyMoment[]; onShow: (eventId: number) => void }) {
  if (!moments.length) return null;
  return (
    <section className="card px-4 py-3" aria-label="Key moments">
      <h3 className="font-display mb-2 text-[20px] font-bold">Key moments</h3>
      <ul className="flex flex-col gap-2">
        {moments.map((m) => (
          <li key={m.kind} className="rounded-2xl border-[3px] border-ink bg-white px-3 py-2">
            <div className="font-display text-[17px] font-bold">{m.title}</div>
            <p className="text-[14.5px] font-bold">{m.text}</p>
            {m.eventId !== undefined && (
              <button className="btn-text mt-1 text-[13px] font-extrabold" onClick={() => onShow(m.eventId!)}>
                Find it in the log
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The post-game recap: winner, standings, the money-over-time chart, key moments and the full log.
 * Everything is read from the engine's event log, so every mode (and every device online) shows the same.
 */
export function RecapScreen({
  game,
  playAgain,
  playAgainNote,
  backToMenu,
}: {
  game: GameState;
  playAgain: SessionButton | null;
  playAgainNote?: string;
  backToMenu: SessionButton;
}) {
  const [field, setField] = useState<'worth' | 'cash'>('worth');
  const [logOpen, setLogOpen] = useState(false);
  const [filter, setFilter] = useState<EventFilter>('all');
  const [pid, setPid] = useState<PlayerId | null>(null);
  const moments = useMemo(() => keyMoments(game), [game]);
  const logRef = useRef<HTMLDivElement>(null);
  const [findId, setFindId] = useState<number | null>(null);
  // Open at the top (the winner), with keyboard focus inside the recap.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    rootRef.current?.scrollTo({ top: 0 });
  }, []);

  // "Find it in the log": open the log unfiltered and scroll to that event.
  useEffect(() => {
    if (findId === null || !logOpen) return;
    const el = logRef.current?.querySelector<HTMLElement>(`[data-event="${findId}"]`);
    el?.scrollIntoView({ block: 'center' });
    el?.classList.add('bg-yellow');
    const t = window.setTimeout(() => el?.classList.remove('bg-yellow'), 2000);
    return () => clearTimeout(t);
  }, [findId, logOpen, filter, pid]);

  return (
    <div ref={rootRef} tabIndex={-1} className="fixed inset-0 z-50 overflow-y-auto bg-ink/80 outline-none" role="dialog" aria-modal="true" aria-label="Game recap">
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-3 py-4 sm:px-4 sm:py-6">
        <WinnerBanner game={game} />
        <Standings game={game} />

        <section className="card px-4 py-3" aria-label="Money over time">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-[20px] font-bold">How it went</h3>
            <div className="flex gap-1.5" role="group" aria-label="Chart shows">
              {(['worth', 'cash'] as const).map((f) => (
                <button key={f} className={`btn btn-sm ${field === f ? 'btn-yellow' : ''}`} aria-pressed={field === f} onClick={() => setField(f)}>
                  {f === 'worth' ? 'Net worth' : 'Cash'}
                </button>
              ))}
            </div>
          </div>
          <MoneyChart key={field} game={game} field={field} />
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] font-extrabold" aria-hidden>
            {game.players.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-5 rounded-full border border-ink" style={{ background: playerColor(p), height: p.id === game.winner ? 7 : 5 }} />
                {p.name}
              </li>
            ))}
          </ul>
        </section>

        <Moments
          moments={moments}
          onShow={(id) => {
            setFilter('all');
            setPid(null);
            setLogOpen(true);
            setFindId(id);
          }}
        />

        <section className="card px-4 py-3" aria-label="Full game log">
          <button className="flex w-full items-center justify-between gap-2 text-left" aria-expanded={logOpen} onClick={() => setLogOpen((o) => !o)}>
            <h3 className="font-display text-[20px] font-bold">Full log</h3>
            <span className="btn btn-sm">{logOpen ? 'Hide' : 'Show full log'}</span>
          </button>
          {logOpen && (
            <div className="mt-2 flex flex-col gap-2" ref={logRef}>
              <EventFilters game={game} filter={filter} setFilter={setFilter} pid={pid} setPid={setPid} />
              <EventList game={game} filter={filter} pid={pid} />
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-center gap-3 pb-4">
          {playAgain ? (
            <button className="btn btn-primary btn-lg on-bg" onClick={playAgain.onClick}>
              {playAgain.label}
            </button>
          ) : (
            playAgainNote && <span className="on-glass text-[15px]">{playAgainNote}</span>
          )}
          <button className="btn btn-lg on-bg" onClick={backToMenu.onClick}>
            {backToMenu.label}
          </button>
        </div>
      </main>
    </div>
  );
}
