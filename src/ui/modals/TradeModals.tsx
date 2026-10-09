import { useEffect, useState } from 'react';
import { CONFIG } from '../../data/config';
import { TYPES, WORDS } from '../../data/theme';
import {
  alivePlayers,
  counterCheck,
  isLegendary,
  proposalNumber,
  tileFee,
  tileForm,
  tileType,
  tradeCheck,
  tradeSidesFor,
  tradeableTiles,
  type TradeBlock,
} from '../../engine/selectors';
import { tradeChanges, tradeEffects, type TradeChange, type TradeEffect } from '../../engine/trade';
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

function blockText(reason: TradeBlock, offer: { give: TradeSide; receive: TradeSide }): string {
  switch (reason) {
    case 'empty':
      return offer.give.tiles.length === 0 && offer.give.money === 0 ? 'Add something you give.' : 'Add something you get.';
    case 'used':
      return 'One offer per turn.';
    case 'money':
      return "That's more money than there is.";
    case 'final':
      return 'This is the final offer: accept or decline.';
    case 'same':
      return 'Change something to send a counter.';
    case 'player':
      return 'Pick a player.';
    default:
      return "You can't trade right now.";
  }
}

type Sides = { give: TradeSide; receive: TradeSide };

/**
 * The two-column editor shared by new offers and counters: `me` gives, `them` gives back. `check`
 * is the engine's validation; `send` gets the sides when it passes.
 */
function OfferEditor({
  game,
  me,
  them,
  initial,
  check,
  note,
  sendLabel,
  send,
  secondary,
  footer,
}: {
  game: GameState;
  me: PlayerId;
  them: PlayerId;
  initial: Sides;
  check: (sides: Sides) => { ok: boolean; reason: TradeBlock | null };
  note: string;
  sendLabel: string;
  send: (sides: Sides) => void;
  secondary: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [give, setGive] = useState<TradeSide>(initial.give);
  const [receive, setReceive] = useState<TradeSide>(initial.receive);
  // Functional updates, so quick successive changes never overwrite each other.
  const toggle = (set: React.Dispatch<React.SetStateAction<TradeSide>>, i: number) =>
    set((side) => ({ ...side, tiles: side.tiles.includes(i) ? side.tiles.filter((x) => x !== i) : [...side.tiles, i] }));
  const other = game.players[them];
  const sides = { give, receive };
  const result = check(sides);
  // Effects are always computed on the proposal as the engine stores it (from the turn player's side).
  const asStored: TradeOffer & { from: PlayerId } =
    me === game.current ? { from: me, to: them, give, receive } : { from: them, to: me, give: receive, receive: give };
  const lines = effectLines(game, tradeEffects(game, asStored, asStored.from), me);
  const mine = tradeableTiles(game, me);
  const theirs = tradeableTiles(game, them);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Column title="You give">
          {mine.length === 0 && <p className="text-[14px] text-ink-soft">No {WORDS.creatures} to trade. {WORDS.starter}s can't be traded.</p>}
          {mine.map((i) => (
            <TradeTile key={i} game={game} tile={i} selected={give.tiles.includes(i)} onToggle={() => toggle(setGive, i)} />
          ))}
          <MoneyField label="Money you give" value={give.money} max={game.players[me].cash} onChange={(n) => setGive((g) => ({ ...g, money: n }))} />
        </Column>
        <Column title="You get">
          {theirs.length === 0 && <p className="text-[14px] text-ink-soft">{other.name} has no {WORDS.creatures} to trade.</p>}
          {theirs.map((i) => (
            <TradeTile key={i} game={game} tile={i} selected={receive.tiles.includes(i)} onToggle={() => toggle(setReceive, i)} />
          ))}
          <MoneyField label={`Money ${other.name} gives`} value={receive.money} max={other.cash} onChange={(n) => setReceive((x) => ({ ...x, money: n }))} />
        </Column>
      </div>
      <EffectsPanel lines={lines} />
      <p className="text-[13px] font-extrabold text-ink-soft">{note}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {footer}
        {!result.ok && result.reason && <span className="mr-auto text-[14px] font-black">{blockText(result.reason, sides)}</span>}
        {secondary}
        <button className="btn btn-primary" disabled={!result.ok} onClick={() => send(sides)}>
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

/** The current player builds one offer: pick a player, pick both sides, read the effects, send. */
export function TradeBuilderModal({ game, onAction, onClose }: { game: GameState; onAction: (a: Action) => void; onClose: () => void }) {
  const me = game.current;
  const others = alivePlayers(game).filter((p) => p !== me);
  const [to, setTo] = useState<PlayerId | null>(others.length === 1 ? others[0] : null);

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
  return (
    <Modal title={`Trade with ${them.name}`} onClose={onClose} wide>
      <OfferEditor
        key={to}
        game={game}
        me={me}
        them={to}
        initial={{ give: { tiles: [], money: 0 }, receive: { tiles: [], money: 0 } }}
        check={(x) => tradeCheck(game, { to, ...x })}
        note={`One offer per turn. ${them.name} can accept, decline or counter; up to ${CONFIG.trade.maxProposals} proposals in all.`}
        sendLabel="Send offer"
        send={(x) => {
          onAction({ type: 'PROPOSE_TRADE', to, ...x });
          onClose();
        }}
        secondary={
          <>
            {others.length > 1 && (
              <button className="btn btn-text" onClick={() => setTo(null)}>
                Change player
              </button>
            )}
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </>
        }
      />
    </Modal>
  );
}

/** A plain-language line per engine change (tradeChanges), from the answerer's side. */
function changeLine(game: GameState, c: TradeChange): string {
  const verb = c.side === 'give' ? 'give' : 'get';
  if (c.kind === 'added') return `Added: you also ${verb} ${tileForm(game, c.tile).name}`;
  if (c.kind === 'removed') return `Removed: ${tileForm(game, c.tile).name} is no longer part of the deal`;
  if (c.before === 0) return `Added: you also ${verb} ${money(c.after)}`;
  if (c.after === 0) return `Removed: you no longer ${verb} ${money(c.before)}`;
  return `Money: you ${verb} ${money(c.after)} (was ${money(c.before)})`;
}

const NewTag = () => <span className="chip text-[11px]">New</span>;

/** One side of the proposal, with what was added ("New") and what was removed (struck through). */
function ChangedSide({ game, now, before, empty }: { game: GameState; now: TradeSide; before: TradeSide | null; empty: string }) {
  const removed = before ? before.tiles.filter((i) => !now.tiles.includes(i)) : [];
  const moneyChanged = before !== null && before.money !== now.money;
  return (
    <>
      {now.tiles.map((i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <TradeTile game={game} tile={i} />
          </div>
          {before && !before.tiles.includes(i) && <NewTag />}
        </div>
      ))}
      {removed.map((i) => (
        <div key={`gone-${i}`} className="flex items-center gap-2 rounded-2xl border-[3px] border-dashed border-ink-soft px-3 py-2 text-ink-soft">
          <s className="font-bold">{tileForm(game, i).name}</s>
          <span className="text-[12px] font-extrabold">removed</span>
        </div>
      ))}
      {now.money > 0 && (
        <div className="font-display flex flex-wrap items-center gap-2 rounded-2xl border-[3px] border-ink bg-white px-3 py-2 text-[20px] font-bold">
          {money(now.money)}
          {moneyChanged && (before!.money === 0 ? <NewTag /> : <span className="text-[14px] text-ink-soft">(was {money(before!.money)})</span>)}
        </div>
      )}
      {moneyChanged && now.money === 0 && (
        <div className="rounded-2xl border-[3px] border-dashed border-ink-soft px-3 py-2 text-ink-soft">
          <s className="font-display text-[18px] font-bold">{money(before!.money)}</s> <span className="text-[12px] font-extrabold">removed</span>
        </div>
      )}
      {now.tiles.length === 0 && now.money === 0 && removed.length === 0 && !moneyChanged && <p className="text-[14px] text-ink-soft">{empty}</p>}
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

/** "Offer 1 of 3", "Counter 2 of 3", "Final offer 3 of 3". */
export function proposalLabel(n: number): string {
  const max = CONFIG.trade.maxProposals;
  if (n >= max) return `Final offer ${n} of ${max}`;
  return n === 1 ? `Offer 1 of ${max}` : `Counter ${n} of ${max}`;
}

/** Who made the newest proposal (proposals alternate, starting with the turn player). */
export function lastProposer(t: { from: PlayerId; to: PlayerId }, proposals: number): PlayerId {
  return proposals % 2 === 1 ? t.from : t.to;
}

/**
 * The answerer sees the newest proposal from their side and answers it: Accept, Decline, or
 * Counter (a pre-filled editor) while the proposal limit allows.
 */
export function TradeAnswerModal({
  game,
  onAction,
  onClose,
  deadline,
  onCounterStart,
}: {
  game: GameState;
  onAction: (a: Action) => void;
  onClose: () => void;
  deadline?: number;
  onCounterStart?: () => void;
}) {
  const t = game.pendingTrade!;
  const me = t.answerer;
  const other = me === t.from ? t.to : t.from;
  const n = proposalNumber(t);
  const final = n >= CONFIG.trade.maxProposals;
  const now = tradeSidesFor(t, me);
  const prevStored = t.history.at(-1);
  const before = prevStored ? tradeSidesFor({ ...prevStored, from: t.from }, me) : null;
  const changes = before ? tradeChanges(before, now) : [];
  const lines = effectLines(game, tradeEffects(game, t, t.from), me);
  const left = useSecondsLeft(deadline);
  const [writing, setWriting] = useState(false);
  const proposer = game.players[lastProposer(t, n)];
  const timer =
    left !== null ? (
      <span className="mr-auto text-[14px] font-black" role="timer" aria-live="off">
        {writing ? 'Send within' : 'Declines automatically in'} {left}s
      </span>
    ) : null;

  if (writing) {
    return (
      <Modal title={`Counter ${game.players[other].name}'s offer`} onClose={onClose} wide>
        <p className="mb-3 text-[14px] font-extrabold text-ink-soft">
          {proposalLabel(n + 1)}. Change anything, then send it back.
        </p>
        <OfferEditor
          game={game}
          me={me}
          them={other}
          initial={now}
          check={(x) => counterCheck(game, x)}
          note={n + 1 >= CONFIG.trade.maxProposals ? `${game.players[other].name} can only accept or decline this one.` : `${game.players[other].name} can accept, decline or counter once more.`}
          sendLabel="Send counter"
          send={(x) => onAction({ type: 'COUNTER_TRADE', ...x })}
          secondary={
            <button className="btn" onClick={() => setWriting(false)}>
              Back
            </button>
          }
          footer={timer}
        />
      </Modal>
    );
  }

  return (
    <Modal title={n === 1 ? `${proposer.name} offers you a trade` : `${proposer.name} countered your offer`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div>
          <span className="chip text-[12px]">{proposalLabel(n)}</span>
          {final && <p className="mt-1 text-[14px] font-extrabold">You can only accept or decline.</p>}
        </div>
        {changes.length > 0 && (
          <section className="rounded-2xl border-[3px] border-ink bg-yellow px-3 py-2" aria-label="What changed">
            <h3 className="font-display text-[16px] font-semibold">What changed</h3>
            <ul className="mt-1 flex flex-col gap-0.5 text-[14px] font-bold">
              {changes.map((c, k) => (
                <li key={k}>{changeLine(game, c)}</li>
              ))}
            </ul>
          </section>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Column title="You give">
            <ChangedSide game={game} now={now.give} before={before?.give ?? null} empty="Nothing" />
          </Column>
          <Column title="You get">
            <ChangedSide game={game} now={now.receive} before={before?.receive ?? null} empty="Nothing" />
          </Column>
        </div>
        <EffectsPanel lines={lines} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {timer}
          <button className="btn" onClick={() => onAction({ type: 'RESPOND_TRADE', accept: false })}>
            Decline
          </button>
          {!final && (
            <button
              className="btn btn-yellow"
              onClick={() => {
                setWriting(true);
                onCounterStart?.();
              }}
            >
              Counter
            </button>
          )}
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
    <SpecialCard kind="card" title={proposalLabel(proposalNumber(t))} fixed={fixed}>
      {game.players[t.from].name} gives {side(t.give)}. {game.players[t.to].name} gives {side(t.receive)}.
    </SpecialCard>
  );
}
