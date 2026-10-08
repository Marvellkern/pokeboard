import { CONFIG } from '../../data/config';
import { WORDS } from '../../data/theme';
import { maxHpFor } from '../../engine/battle';
import { challengeCosts, challengeOpponent, fighterInfo, fightersOf, typeMultiplier } from '../../engine/selectors';
import type { Action, GameState } from '../../engine/types';
import { Chip, Modal, Render, TypeChip } from '../common';
import { money, multiplierTag } from '../format';

const toneStyle = {
  good: { background: 'var(--hp-green)', color: 'var(--ink)' },
  bad: { background: 'var(--red)', color: '#fff' },
  neutral: { background: 'var(--ink-soft)', color: '#fff' },
};

/** Pick a fighter (or pay) for a fee battle, ambush, or hideout guard. */
export function ChallengeModal({
  game,
  onAction,
  onClose,
}: {
  game: GameState;
  onAction: (a: Action) => void;
  onClose: () => void;
}) {
  const pid = game.current;
  const me = game.players[pid];
  const opp = challengeOpponent(game)!;
  const fighters = fightersOf(game, pid)
    .map((ref) => fighterInfo(game, pid, ref))
    .map((f) => ({ f, mine: typeMultiplier(f.type, opp.type), theirs: typeMultiplier(opp.type, f.type) }));

  let payLabel = `Pay ${money(CONFIG.hideout.fee)}`;
  const costs = challengeCosts(game);
  if (costs) payLabel = `Pay ${money(costs.pay)}`;

  return (
    <Modal title="Choose your fighter" onClose={onClose} wide>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-[15px] text-ink-soft">
        Defender: <TypeChip type={opp.type} /> <Chip>Lv {opp.level}</Chip> <Chip>HP {maxHpFor(opp.level)}</Chip> moves first.
      </p>
      {costs && (
        <p className="mb-3 text-[15px]">
          Win: pay nothing. Lose: pay <b>{money(costs.loseBattle)}</b>. Or pay <b>{money(costs.pay)}</b> now.
        </p>
      )}
      <ul className="flex flex-col gap-2.5">
        {fighters.map(({ f, mine, theirs }) => {
          const m = multiplierTag(mine);
          const t = multiplierTag(theirs);
          const theirTone = t.tone === 'good' ? 'bad' : t.tone === 'bad' ? 'good' : 'neutral';
          return (
            <li key={f.tile ?? 'starter'} className="flex flex-wrap items-center gap-3 rounded-2xl border-[3px] border-ink p-2.5">
              <Render dex={f.dex} name={f.name} type={f.type} size={56} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[19px] font-bold">
                  {f.name}
                  {f.tile === null && <span className="ml-1.5 text-[13px] font-semibold text-ink-soft">{WORDS.starter}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px]">
                  <TypeChip type={f.type} />
                  <Chip>Lv {f.level}</Chip>
                  <Chip style={toneStyle[m.tone]}>Yours {m.text}</Chip>
                  <Chip style={toneStyle[theirTone]}>Theirs {t.text}</Chip>
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => onAction({ type: 'BATTLE', fighter: f.ref })}>
                Battle!
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn" onClick={() => onAction({ type: 'PAY' })}>
          {payLabel}
        </button>
        <span className="text-[15px] text-ink-soft">You have {money(me.cash)}</span>
      </div>
    </Modal>
  );
}
