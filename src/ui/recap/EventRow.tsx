import type { ReactNode } from 'react';
import { eventDelta } from '../../engine/recap';
import type { GameEvent, GameEventType, GameState, PlayerId } from '../../engine/types';
import { money, seatLabel } from '../format';
import { BallIcon } from '../icons';

export type EventFilter = 'all' | 'battles' | 'catches' | 'money' | 'trades';

export const FILTERS: { id: EventFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'battles', label: 'Battles' },
  { id: 'catches', label: 'Catches' },
  { id: 'money', label: 'Money' },
  { id: 'trades', label: 'Trades' },
];

const CATEGORY: Partial<Record<EventFilter, GameEventType[]>> = {
  battles: ['battle_won', 'battle_lost'],
  catches: ['catch_success', 'catch_fail', 'ball_purchase'],
  trades: ['trade', 'trade_counter', 'trade_declined'],
};

/** Does event k pass the type filter and (if set) involve this player? */
export function eventMatches(events: GameEvent[], k: number, filter: EventFilter, pid: PlayerId | null): boolean {
  const e = events[k];
  const delta = eventDelta(events, k);
  if (filter === 'money' ? !delta.some((d) => d !== 0) : filter !== 'all' && !CATEGORY[filter]!.includes(e.type)) return false;
  if (pid === null) return true;
  const m = e.meta;
  return e.player === pid || delta[pid] !== 0 || m?.opponent === pid || m?.to === pid || m?.with === pid;
}

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const ICONS: Record<GameEventType, { bg: string; label: string; icon: ReactNode }> = {
  start: { bg: 'var(--ink)', label: 'Start', icon: svg(<path d="M6 21V4h10l-2 4 2 4H6" />) },
  roll: {
    bg: 'var(--event-move)',
    label: 'Roll',
    icon: svg(
      <>
        <rect x="4" y="4" width="16" height="16" rx="3.5" />
        <path d="M9 9h.01M15 15h.01M12 12h.01" />
      </>,
    ),
  },
  move: { bg: 'var(--event-move)', label: 'Move', icon: svg(<path d="M4 12h15M13 6l6 6-6 6" />) },
  card: { bg: 'var(--event-card)', label: 'Card', icon: svg(<rect x="6" y="3" width="12" height="18" rx="2.5" />) },
  ball_purchase: { bg: 'var(--ink-soft)', label: 'Shop', icon: null },
  catch_success: { bg: 'var(--gain)', label: 'Caught', icon: null },
  catch_fail: { bg: 'var(--ink-soft)', label: 'Missed', icon: null },
  battle_won: { bg: 'var(--gain)', label: 'Battle won', icon: svg(<path d="M5 19L19 5M14 5h5v5M5 5l14 14M10 19H5v-5" />) },
  battle_lost: { bg: 'var(--red)', label: 'Battle lost', icon: svg(<path d="M5 19L19 5M14 5h5v5M5 5l14 14M10 19H5v-5" />) },
  payment: { bg: 'var(--event-money)', label: 'Payment', icon: svg(<path d="M4 12h12M12 7l5 5-5 5M20 5v14" />) },
  money_gain: { bg: 'var(--event-money)', label: 'Money', icon: svg(<path d="M12 5v14M5 12h14" />) },
  level_up: { bg: 'var(--event-level)', label: 'Level up', icon: svg(<path d="M6 14l6-6 6 6M6 20l6-6 6 6" />) },
  release: { bg: 'var(--ink-soft)', label: 'Released', icon: svg(<path d="M12 19V5M6 11l6-6 6 6" />) },
  trade: { bg: 'var(--event-trade)', label: 'Trade', icon: svg(<path d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />) },
  trade_counter: { bg: 'var(--event-trade)', label: 'Counter', icon: svg(<path d="M20 8H6M10 4L6 8l4 4M4 16h14M14 12l4 4-4 4" />) },
  trade_declined: { bg: 'var(--ink-soft)', label: 'Declined', icon: svg(<path d="M6 6l12 12M18 6L6 18" />) },
  bankruptcy: { bg: 'var(--red)', label: 'Bankrupt', icon: svg(<path d="M6 6l12 12M18 6L6 18" />) },
  game_over: { bg: 'var(--ink)', label: 'Game over', icon: svg(<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />) },
};

export function EventIcon({ e }: { e: GameEvent }) {
  const style = ICONS[e.type];
  const ball = e.meta?.ball;
  if (ball && (e.type === 'catch_success' || e.type === 'catch_fail' || e.type === 'ball_purchase')) {
    return (
      <span className={`flex h-6 w-6 flex-none items-center justify-center ${e.type === 'catch_fail' ? 'opacity-50 grayscale' : ''}`} title={style.label}>
        <BallIcon ball={ball} size={22} />
      </span>
    );
  }
  return (
    <span
      className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-ink text-white"
      style={{ background: style.bg }}
      title={style.label}
    >
      {style.icon}
    </span>
  );
}

/** "+₽100" / "−₽100" per player whose cash changed, with seat labels (never color alone). */
export function MoneyChanges({ game, delta }: { game: GameState; delta: number[] }) {
  const moved = delta.flatMap((d, i) => (d !== 0 ? [[i, d] as const] : []));
  if (!moved.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {moved.map(([i, d]) => (
        <span
          key={i}
          className="font-display rounded-full px-1.5 text-[12px] leading-[18px] font-bold whitespace-nowrap text-white"
          style={{ background: d > 0 ? 'var(--gain)' : 'var(--red)' }}
        >
          {seatLabel(game.players[i])} {d > 0 ? '+' : '−'}
          {money(Math.abs(d))}
        </span>
      ))}
    </span>
  );
}

export function EventRow({ game, k, highlight = false }: { game: GameState; k: number; highlight?: boolean }) {
  const e = game.events[k];
  return (
    <li className={`flex items-start gap-2 rounded-xl px-1.5 py-1 ${highlight ? 'bg-yellow' : ''}`} data-event={e.id}>
      <span className="font-display mt-0.5 w-7 flex-none text-[12px] font-bold text-ink-soft">R{e.round}</span>
      <EventIcon e={e} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] leading-snug font-bold break-words">{e.text}</span>
        <MoneyChanges game={game} delta={eventDelta(game.events, k)} />
      </span>
    </li>
  );
}
