import { useEffect, useState } from 'react';
import { TYPES, WORDS } from '../../data/theme';
import { alivePlayers, isLegendary, tileFee, tileForm, tileType, tradeCheck, tradeableTiles, type TradeBlock } from '../../engine/selectors';
import { tradeEffects, type TradeEffect } from '../../engine/trade';
import type { Action, GameState, PlayerId, TradeOffer, TradeSide } from '../../engine/types';
import { SpecialCard } from '../cards';
import { Modal, PlayerChip, Render, TypeChip } from '../common';
import { money } from '../format';

type Tone = 'good' | 'bad' | 'info';

/** One plain-language line per engine effect, from `pov`'s point of view. */
export function effectLines(game: GameState, effects: TradeEffect[], pov: PlayerId): { tone: Tone; text: string }[] {
  const whose = (pid: PlayerId) => (pid === pov ? 'your' : `${game.players[pid].name}'s`);
  return effects.map((e) => {
    const mine = e.player === pov;
    switch (e.kind) {
      case 'reset': {
        const name = tileForm(game, e.tile).name;
        return mine
          ? { tone: 'bad', text: `${name} resets to Lv 1. You lose ${money(e.lost)} spent on levels.` }
          : { tone: 'info', text: `${name} resets to Lv 1 when it changes hands.` };
      }
      case 'pairBroken': {
        const name = tileForm(game, e.tile).name;
        const drop = e.toLevel < e.fromLevel ? ` ${name} drops to Lv ${e.toLevel}.` : '';
        return { tone: mine ? 'bad' : 'info', text: `This breaks ${whose(e.player)} ${TYPES[e.type].name} pair.${drop}` };
      }
      case 'pairCompleted':
        return { tone: mine ? 'good' : 'bad', text: `This completes ${whose(e.player)} ${TYPES[e.type].name} pair.` };
      case 'legendaryFee': {
        const up = e.after > e.before;
        const text = `${whose(e.player)[0].toUpperCase()}${whose(e.player).slice(1)} ${WORDS.legendary.toLowerCase()} fee goes from ${money(e.before)} to ${money(e.after)}.`;
        return { tone: mine ? (up ? 'good' : 'bad') : 'info', text };
      }
    }
  });
}

const TONE_MARK: Record<Tone, { mark: string; label: string; color: string }> = {
  good: { mark: '+', label: 'Good for you', color: 'var(--hp-green)' },
  bad: { mark: '−', label: 'Bad for you', color: 'var(--red)' },
  info: { mark: '•', label: 'Note', color: 'var(--ink-soft)' },
};

function EffectsPanel({ lines }: { lines: { tone: Tone; text: string }[] }) {
  return (
    <section className="rounded-2xl border-[3px] border-ink bg-white px-3 py-2" aria-label="What this trade does" aria-live="polite">
      <h3 className="font-display text-[16px] font-semibold">What this trade does</h3>
      {lines.length === 0 ? (
        <p className="text-[14px] text-ink-soft">No level or pair changes. Creatures move at their price; money at face value.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {lines.map((l, k) => (
            <li key={k} className="flex items-start gap-2 text-[14px] leading-snug font-bold">
              <span
                className="font-display mt-px inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[14px] text-white"
                style={{ background: TONE_MARK[l.tone].color }}
                aria-label={TONE_MARK[l.tone].label}
                role="img"
              >
                {TONE_MARK[l.tone].mark}
              </span>
              {l.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A small tile card: render, name, type, level and current fee. */
function TradeTile({ game, tile, selected, onToggle }: { game: GameState; tile: number; selected?: boolean; onToggle?: () => void }) {
  const f = tileForm(game, tile);
  const body = (
    <>
      <Render dex={f.dex} name={f.name} type={tileType(game, tile)} size={44} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[15px] font-black">{f.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px]">
          <TypeChip type={tileType(game, tile)} className="text-[11px]" />
          <span className="font-extrabold text-ink-soft">
            {isLegendary(game, tile) ? WORDS.legendary : `Lv ${game.tiles[tile].level}`} · Fee {money(tileFee(game, tile))}
          </span>
        </span>
      </span>
      {onToggle && (
        <span className="font-display flex h-6 w-6 flex-none items-center justify-center rounded-full border-[3px] border-ink text-[14px]" aria-hidden>
          {selected ? '✓' : ''}
        </span>
      )}
    </>
  );
  const cls = `flex w-full items-center gap-2 rounded-2xl border-[3px] border-ink p-1.5 ${selected ? 'bg-yellow' : 'bg-white'}`;
  return onToggle ? (
    <button type="button" className={cls} aria-pressed={selected} onClick={onToggle}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function MoneyField({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  const clamp = (n: number) => Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)));
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="btn btn-sm min-w-10 px-2" aria-label={`${label}: ${money(10)} less`} disabled={value <= 0} onClick={() => onChange(clamp(value - 10))}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        step={10}
        aria-label={label}
        className="font-display h-10 w-24 rounded-xl border-[3px] border-ink px-2 text-center text-[17px] font-semibold"
        value={value}
        onChange={(e) => onChange(clamp(e.target.valueAsNumber))}
      />
      <button type="button" className="btn btn-sm min-w-10 px-2" aria-label={`${label}: ${money(10)} more`} disabled={value >= max} onClick={() => onChange(clamp(value + 10))}>
        +
      </button>
      <span className="text-[12px] font-extrabold text-ink-soft">of {money(max)}</span>
    </div>
  );
}

function Column({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <h3 className="font-display text-[18px] font-bold">{title}</h3>
      {children}
    </section>
  );
}

function blockText(reason: TradeBlock, offer: TradeOffer): string {
  switch (reason) {
    case 'empty':
      return offer.give.tiles.length === 0 && offer.give.money === 0 ? 'Add something you give.' : 'Add something you get.';
    case 'used':
      return 'One offer per turn.';
    case 'money':
      return "That's more money than there is.";
    case 'player':
      return 'Pick a player.';
    default:
      return "You can't trade right now.";
  }
}

/** The current player builds one offer: pick a player, pick both sides, read the effects, send. */
export function TradeBuilderModal({ game, onAction, onClose }: { game: GameState; onAction: (a: Action) => void; onClose: () => void }) {
  const me = game.current;
  const others = alivePlayers(game).filter((p) => p !== me);
  const [to, setTo] = useState<PlayerId | null>(others.length === 1 ? others[0] : null);
  const [give, setGive] = useState<TradeSide>({ tiles: [], money: 0 });
  const [receive, setReceive] = useState<TradeSide>({ tiles: [], money: 0 });
  const toggle = (side: TradeSide, set: (s: TradeSide) => void, i: number) =>
    set({ ...side, tiles: side.tiles.includes(i) ? side.tiles.filter((x) => x !== i) : [...side.tiles, i] });

  if (to === null) {
    return (
      <Modal title="Trade with…" onClose={onClose}>
        <ul className="flex flex-col gap-2">
          {others.map((pid) => {
            const p = game.players[pid];
            return (
              <li key={pid}>
                <button className="btn w-full justify-between" onClick={() => setTo(pid)}>
                  <PlayerChip player={p} />
                  <span className="text-[14px] font-extrabold">
                    {tradeableTiles(game, pid).length} {WORDS.creatures} · {money(p.cash)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>
    );
  }

  const them = game.players[to];
  const offer: TradeOffer = { to, give, receive };
  const check = tradeCheck(game, offer);
  const lines = effectLines(game, tradeEffects(game, offer, me), me);
  const mine = tradeableTiles(game, me);
  const theirs = tradeableTiles(game, to);
  return (
    <Modal title={`Trade with ${them.name}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Column title="You give">
            {mine.length === 0 && <p className="text-[14px] text-ink-soft">No {WORDS.creatures} to trade. {WORDS.starter}s can't be traded.</p>}
            {mine.map((i) => (
              <TradeTile key={i} game={game} tile={i} selected={give.tiles.includes(i)} onToggle={() => toggle(give, setGive, i)} />
            ))}
            <MoneyField label="Money you give" value={give.money} max={game.players[me].cash} onChange={(n) => setGive({ ...give, money: n })} />
          </Column>
          <Column title="You get">
            {theirs.length === 0 && <p className="text-[14px] text-ink-soft">{them.name} has no {WORDS.creatures} to trade.</p>}
            {theirs.map((i) => (
              <TradeTile key={i} game={game} tile={i} selected={receive.tiles.includes(i)} onToggle={() => toggle(receive, setReceive, i)} />
            ))}
            <MoneyField label={`Money ${them.name} gives`} value={receive.money} max={them.cash} onChange={(n) => setReceive({ ...receive, money: n })} />
          </Column>
        </div>
        <EffectsPanel lines={lines} />
        <p className="text-[13px] font-extrabold text-ink-soft">One offer per turn. {them.name} can accept or decline, not change it.</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!check.ok && check.reason && <span className="mr-auto text-[14px] font-black">{blockText(check.reason, offer)}</span>}
          {others.length > 1 && (
            <button className="btn btn-text" onClick={() => setTo(null)}>
              Change player
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!check.ok}
            onClick={() => {
              onAction({ type: 'PROPOSE_TRADE', ...offer });
              onClose();
            }}
          >
            Send offer
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SideList({ game, side, empty }: { game: GameState; side: TradeSide; empty: string }) {
  return (
    <>
      {side.tiles.map((i) => (
        <TradeTile key={i} game={game} tile={i} />
      ))}
      {side.money > 0 && (
        <div className="font-display rounded-2xl border-[3px] border-ink bg-white px-3 py-2 text-[20px] font-bold">{money(side.money)}</div>
      )}
      {side.tiles.length === 0 && side.money === 0 && <p className="text-[14px] text-ink-soft">{empty}</p>}
    </>
  );
}

function useSecondsLeft(deadline?: number): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

/** The recipient sees the offer from their side and answers it. */
export function TradeAnswerModal({
  game,
  onAction,
  onClose,
  deadline,
}: {
  game: GameState;
  onAction: (a: Action) => void;
  onClose: () => void;
  deadline?: number;
}) {
  const t = game.pendingTrade!;
  const from = game.players[t.from];
  const lines = effectLines(game, tradeEffects(game, t, t.from), t.to);
  const left = useSecondsLeft(deadline);
  return (
    <Modal title={`${from.name} offers you a trade`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Column title="You give">
            <SideList game={game} side={t.receive} empty="Nothing" />
          </Column>
          <Column title="You get">
            <SideList game={game} side={t.give} empty="Nothing" />
          </Column>
        </div>
        <EffectsPanel lines={lines} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {left !== null && (
            <span className="mr-auto text-[14px] font-black" role="timer" aria-live="off">
              Declines automatically in {left}s
            </span>
          )}
          <button className="btn" onClick={() => onAction({ type: 'RESPOND_TRADE', accept: false })}>
            Decline
          </button>
          <button className="btn btn-primary" onClick={() => onAction({ type: 'RESPOND_TRADE', accept: true })}>
            Accept
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Compact "who gives what" for the stage card while an offer is pending. */
export function TradeSummaryCard({ game, fixed = false }: { game: GameState; fixed?: boolean }) {
  const t = game.pendingTrade!;
  const side = (s: TradeSide) =>
    [...s.tiles.map((i) => tileForm(game, i).name), ...(s.money > 0 ? [money(s.money)] : [])].join(' + ') || 'nothing';
  return (
    <SpecialCard kind="card" title="Trade offer" fixed={fixed}>
      {game.players[t.from].name} gives {side(t.give)}. {game.players[t.to].name} gives {side(t.receive)}.
    </SpecialCard>
  );
}
