import { CONFIG } from '../../data/config';
import { STARTERS, WORDS } from '../../data/theme';
import {
  fighterInfo,
  fightersOf,
  isLegendary,
  levelUpCheck,
  netWorth,
  ownedTiles,
  ranking,
  releaseValue,
  tileFee,
  tileForm,
  tileType,
} from '../../engine/selectors';
import type { Action, GameState } from '../../engine/types';
import { Avatar, Chip, Modal, Outlined, PlayerName, Render, TypeChip } from '../common';
import { levelBlockText, logActor, money, playerColor } from '../format';

export function ManageTeamModal({
  game,
  canAct,
  onAction,
  onClose,
}: {
  game: GameState;
  canAct: boolean;
  onAction: (a: Action) => void;
  onClose: () => void;
}) {
  const pid = game.current;
  const p = game.players[pid];
  const fighters = fightersOf(game, pid).map((ref) => fighterInfo(game, pid, ref));
  return (
    <Modal title={`${p.name}'s team`} onClose={onClose} wide>
      <p className="mb-3 text-[15px]">
        Cash: <b className="font-display text-[18px]">{money(p.cash)}</b>
        {!canAct && <span className="ml-2 text-ink-soft">Leveling is only possible on your turn: before rolling, while deciding to buy, or before ending it.</span>}
      </p>
      <ul className="flex flex-col gap-2.5">
        {fighters.map((f) => {
          const check = levelUpCheck(game, pid, f.ref);
          const isStarter = f.ref.kind === 'starter';
          const legendary = f.tile !== null && isLegendary(game, f.tile);
          const reason = !check.ok && check.reason ? levelBlockText(check.reason, f.tile !== null ? tileType(game, f.tile) : null) : null;
          return (
            <li key={f.tile ?? 'starter'} className="flex flex-wrap items-center gap-3 rounded-2xl border-[3px] border-ink p-2.5">
              <Render dex={f.dex} name={f.name} type={f.type} size={56} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[19px] font-bold">{f.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px]">
                  <TypeChip type={f.type} />
                  <Chip>Lv {f.level}</Chip>
                  {isStarter ? (
                    <Chip style={{ background: 'var(--ink-soft)' }}>{WORDS.starter} · no fees</Chip>
                  ) : (
                    <Chip style={{ background: 'var(--ink-soft)' }}>Fee {money(tileFee(game, f.tile!))}</Chip>
                  )}
                  {!legendary && check.reason !== 'maxLevel' && <span className="font-extrabold text-ink-soft">Next {money(check.cost)}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!check.ok || !canAct}
                  onClick={() => onAction({ type: 'LEVEL_UP', target: f.ref })}
                >
                  Level up
                </button>
                {reason && <span className="text-[12.5px] font-extrabold text-ink-soft">{reason}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

export function LiquidateModal({
  game,
  onAction,
  onClose,
}: {
  game: GameState;
  onAction: (a: Action) => void;
  onClose: () => void;
}) {
  const d = game.debt!;
  const p = game.players[d.debtor];
  const tiles = ownedTiles(game, d.debtor);
  const totalValue = tiles.reduce((s, i) => s + releaseValue(game, i), 0);
  const short = Math.max(0, d.amount - p.cash);
  const to = d.creditor === null ? 'the bank' : game.players[d.creditor].name;
  return (
    <Modal title="Not enough money!" onClose={onClose}>
      <div className="flex flex-col gap-3 text-[15px]">
        <p>
          <PlayerName player={p} /> owes <b>{money(d.amount)}</b> to {to} but has <b>{money(p.cash)}</b>. Release{' '}
          {WORDS.creatures} back to the wild for {Math.round(CONFIG.liquidationRatio * 100)}% of what you invested.
        </p>
        <div className="flex justify-between rounded-2xl border-[3px] border-ink bg-yellow px-3 py-2 font-black">
          <span>Still needed: {money(short)}</span>
          <span>Can raise: {money(totalValue)}</span>
        </div>
        {totalValue < short && <p className="font-black text-red">Even releasing everything won't cover it. You'll go bankrupt.</p>}
        <ul className="flex flex-col gap-2">
          {tiles.map((i) => {
            const f = tileForm(game, i);
            return (
              <li key={i} className="flex items-center gap-3 rounded-2xl border-[3px] border-ink p-2">
                <Render dex={f.dex} name={f.name} type={tileType(game, i)} size={48} />
                <div className="flex-1">
                  <div className="font-display text-[18px] font-bold">{f.name}</div>
                  <div className="text-[13px] text-ink-soft">
                    Lv {game.tiles[i].level} · Fee {money(tileFee(game, i))}
                  </div>
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => onAction({ type: 'RELEASE', tile: i })}>
                  {WORDS.release} +{money(releaseValue(game, i))}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

export function FullLogModal({ game, onClose }: { game: GameState; onClose: () => void }) {
  const entries = [...game.log].reverse();
  return (
    <Modal title="Full log" onClose={onClose} wide>
      <ol className="flex flex-col gap-1 text-[15px]">
        {entries.map((e, k) => {
          if (e.text.startsWith('──')) {
            return (
              <li key={e.id} className="py-1 text-center text-[13px] text-ink-soft">
                {e.text}
              </li>
            );
          }
          const who = logActor(game, e.text);
          return (
            <li key={e.id} className={`flex items-start gap-2 ${k === 0 ? 'font-black' : 'text-ink-soft'}`}>
              <span
                className="mt-[6px] inline-block h-2.5 w-2.5 flex-none rounded-full border-2 border-ink"
                style={{ background: who ? playerColor(who) : 'var(--ink-soft)' }}
                aria-hidden
              />
              {e.text}
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}

export function GameOverModal({
  game,
  playAgain,
  note,
}: {
  game: GameState;
  playAgain: { label: string; onClick: () => void } | null;
  note?: string;
}) {
  const order = ranking(game);
  const winner = game.winner !== null ? game.players[game.winner] : null;
  return (
    <Modal title="Game over!" outlinedTitle>
      <div className="flex flex-col gap-3">
        {winner && (
          <div className="flex flex-col items-center gap-2 text-center">
            <Avatar player={winner} dex={STARTERS[winner.starter].dex} name={STARTERS[winner.starter].name} size={120} ring={7} />
            <Outlined className="text-[36px]">{winner.name} wins!</Outlined>
          </div>
        )}
        <p className="text-center text-[15px] text-ink-soft">Rounds played: {game.round}</p>
        <ol className="flex flex-col gap-1.5">
          {order.map((id, k) => {
            const p = game.players[id];
            return (
              <li
                key={id}
                className={`flex items-center justify-between rounded-2xl border-[3px] border-ink px-3 py-2 ${k === 0 ? 'bg-yellow' : 'bg-white'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-display text-[18px] font-bold">{k + 1}.</span>
                  <PlayerName player={p} />
                </span>
                <span className="font-display text-[17px] font-semibold">{p.bankrupt ? 'Out' : money(netWorth(game, id))}</span>
              </li>
            );
          })}
        </ol>
        {playAgain ? (
          <button className="btn btn-primary btn-lg self-center" onClick={playAgain.onClick}>
            {playAgain.label}
          </button>
        ) : (
          note && <p className="text-center text-[15px] font-extrabold text-ink-soft">{note}</p>
        )}
      </div>
    </Modal>
  );
}

