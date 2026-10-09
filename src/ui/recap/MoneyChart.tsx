import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { chartPoints } from '../../engine/recap';
import type { GameState } from '../../engine/types';
import { money, playerColor, seatLabel, textOn } from '../format';

const H = 230;
const PAD = { l: 44, r: 30, t: 12, b: 26 };

const compact = (n: number) => (Math.abs(n) >= 1000 ? `${Number((n / 1000).toFixed(2))}k` : `${n}`);

/** The y-axis range fitted to the data (so close games stay readable), on round grid steps. */
function yRange(values: number[]): { bottom: number; top: number; lines: number[] } {
  const lo = Math.min(...values);
  const hi = Math.max(1, ...values);
  const span = Math.max(hi - lo, 400);
  const step = [50, 100, 250, 500, 1000, 2500, 5000, 10000].find((s) => span / s <= 4) ?? 20000;
  const bottom = Math.max(0, Math.floor((lo - span * 0.1) / step) * step);
  const top = Math.ceil((hi + span * 0.08) / step) * step;
  const lines: number[] = [];
  for (let v = bottom; v <= top; v += step) lines.push(v);
  return { bottom, top, lines };
}

/**
 * One line per player over the game (net worth or cash), from the event snapshots. The winner's
 * line is thicker; every line ends in its seat label. Tap, hover or use arrow keys to inspect.
 */
export function MoneyChart({ game, field }: { game: GameState; field: 'cash' | 'worth' }) {
  const pts = useMemo(() => chartPoints(game.events, field), [game.events, field]);
  const [sel, setSel] = useState<number | null>(null);
  // Drawn at the container's real width, so text and height stay the same size on phones and desktops.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(360);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const update = () => setW(Math.max(260, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = pts.length;
  const { bottom, top, lines } = yRange(pts.flatMap((p) => p.values));
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - bottom) / (top - bottom)) * (H - PAD.t - PAD.b);

  // Round ticks: the first point of each round, thinned to at most ~6 labels.
  const roundStarts = pts.flatMap((p, i) => (i === 0 || game.events[p.k].round !== game.events[pts[i - 1].k].round ? [i] : []));
  const every = Math.max(1, Math.ceil(roundStarts.length / 6));
  const ticks = roundStarts.filter((_, j) => j % every === 0);

  // End labels pushed apart so they don't overlap.
  const ends = game.players
    .map((p) => ({ p, y: y(pts[n - 1]?.values[p.id] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let j = 1; j < ends.length; j++) ends[j].y = Math.max(ends[j].y, ends[j - 1].y + 13);

  const pick = (clientX: number, rect: DOMRect) => {
    const vx = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round(((vx - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1));
    setSel(Math.max(0, Math.min(n - 1, i)));
  };
  const onPointer = (e: PointerEvent<SVGSVGElement>) => pick(e.clientX, e.currentTarget.getBoundingClientRect());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setSel((s) => Math.min(n - 1, (s ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setSel((s) => Math.max(0, (s ?? n) - 1));
    else if (e.key === 'Home') setSel(0);
    else if (e.key === 'End') setSel(n - 1);
    else return;
    e.preventDefault();
  };

  const label = field === 'worth' ? 'Net worth' : 'Cash';
  const finals = game.players.map((p) => `${p.name} ${money(pts[n - 1]?.values[p.id] ?? 0)}`).join(', ');
  const selEvent = sel !== null ? game.events[pts[sel].k] : null;

  return (
    <div className="flex flex-col gap-2" ref={wrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full touch-pan-y select-none outline-none focus-visible:ring-4 focus-visible:ring-ink"
        role="img"
        aria-label={`${label} over the game. Final: ${finals}. Use the arrow keys to step through it.`}
        tabIndex={0}
        onPointerDown={onPointer}
        onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons) && onPointer(e)}
        onKeyDown={onKey}
      >
        {lines.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(19,28,63,.15)" strokeWidth={1} />
            <text x={PAD.l - 5} y={y(v) + 3.5} textAnchor="end" fontSize="10" fontWeight="800" fill="var(--ink-soft)">
              {compact(v)}
            </text>
          </g>
        ))}
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--ink-soft)">
            R{game.events[pts[i].k].round}
          </text>
        ))}
        {game.players.map((p) => {
          const d = pts.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pt.values[p.id] ?? 0).toFixed(1)}`).join('');
          const win = p.id === game.winner;
          return (
            <path
              key={`${field}-${p.id}`}
              d={d}
              fill="none"
              stroke={playerColor(p)}
              strokeWidth={win ? 4.5 : 2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              className="chart-draw"
              style={{ filter: 'drop-shadow(0 1px 0 rgba(19,28,63,.45))' }}
            />
          );
        })}
        {ends.map(({ p, y: ey }) => {
          const c = playerColor(p);
          return (
            <g key={p.id} transform={`translate(${W - PAD.r + 3},${ey})`}>
              <rect x={0} y={-7} width={26} height={14} rx={7} fill={c} stroke="var(--ink)" strokeWidth={1.5} />
              <text x={13} y={3.5} textAnchor="middle" fontSize="9.5" fontWeight="900" fill={textOn(c)}>
                {seatLabel(p)}
              </text>
            </g>
          );
        })}
        {sel !== null && (
          <g pointerEvents="none">
            <line x1={x(sel)} x2={x(sel)} y1={PAD.t} y2={H - PAD.b} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="3 3" />
            {game.players.map((p) => (
              <circle key={p.id} cx={x(sel)} cy={y(pts[sel].values[p.id] ?? 0)} r={4} fill={playerColor(p)} stroke="var(--ink)" strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>
      <div className="min-h-[64px] rounded-2xl border-[3px] border-ink bg-white px-3 py-2 text-[14px]" aria-live="polite">
        {selEvent ? (
          <>
            <div className="text-[12px] font-extrabold text-ink-soft">
              Round {selEvent.round} · turn {selEvent.turn}
            </div>
            <div className="font-bold">{selEvent.text}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] font-extrabold">
              {game.players.map((p) => (
                <span key={p.id}>
                  {seatLabel(p)} {p.name}: {money(pts[sel!].values[p.id] ?? 0)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <span className="font-bold text-ink-soft">Tap or drag across the chart to see what happened at each point.</span>
        )}
      </div>
    </div>
  );
}
