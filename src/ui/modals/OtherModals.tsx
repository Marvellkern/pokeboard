import { CONFIG } from '../../data/config';
import { WORDS } from '../../data/theme';
import {
  fighterInfo,
  fightersOf,
  isLegendary,
  levelUpCheck,
  ownedTiles,
  releaseValue,
  tileFee,
  tileForm,
  tileType,
} from '../../engine/selectors';
import type { Action, GameState, PlayerId } from '../../engine/types';
import { Chip, Modal, PlayerName, Render, TypeChip } from '../common';
import { levelBlockText, money } from '../format';

/** A player's team. `own` = it's this device's player (leveling controls are shown); `canAct` = they can level right now. */
export function ManageTeamModal({
  game,
  pid,
  own,
  canAct,
  onAction,
  onClose,
}: {
  game: GameState;
  pid: PlayerId;
  own: boolean;
  canAct: boolean;
  onAction: (a: Action) => void;
  onClose: () => void;
}) {
  const p = game.players[pid];
  const fighters = fightersOf(game, pid).map((ref) => fighterInfo(game, pid, ref));
  return (
    <Modal title={`${p.name}'s team`} onClose={onClose} wide>
      <p className="mb-3 text-[15px]">
        Cash: <b className="font-display text-[18px]">{money(p.cash)}</b>
        {own && !canAct && <span className="ml-2 text-ink-soft">Leveling is only possible on your turn: before rolling, while deciding to buy, or before ending it.</span>}
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
              {own && (
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
              )}
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
