import { CONFIG } from '../../data/config';
import { BALLS, SHOP_BALLS, type BallKind } from '../../data/theme';
import { ballBuyCheck, ballsCarried } from '../../engine/selectors';
import type { Action, GameState } from '../../engine/types';
import { Modal } from '../common';
import { ballBlockText, money } from '../format';
import { BallIcon } from '../icons';

/** Ball shop: open at the start of your turn until you roll. Legality comes from the engine. */
export function ShopModal({ game, onAction, onClose }: { game: GameState; onAction: (a: Action) => void; onClose: () => void }) {
  const p = game.players[game.current];
  const carried = ballsCarried(game, game.current);
  const slots: (BallKind | null)[] = [
    ...SHOP_BALLS.flatMap((b) => Array<BallKind>(p.balls[b]).fill(b)),
    ...Array(Math.max(0, CONFIG.balls.carryLimit - carried)).fill(null),
  ];
  return (
    <Modal title="Ball shop" onClose={onClose} wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2" aria-label={`Bag ${carried} of ${CONFIG.balls.carryLimit}`}>
          <span className="font-display text-[17px] font-semibold">
            Bag {carried} / {CONFIG.balls.carryLimit}
          </span>
          {slots.map((b, k) => (
            <span key={k} className={`ball-slot ${b ? 'filled' : ''}`}>
              {b && <BallIcon ball={b} size={30} />}
            </span>
          ))}
        </div>
        <span className="font-display text-[17px] font-semibold">Cash {money(p.cash)}</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {SHOP_BALLS.map((b) => {
          const check = ballBuyCheck(game, b);
          return (
            <li key={b} className="flex flex-col items-center gap-1.5 rounded-2xl border-[3px] border-ink p-3 text-center">
              <BallIcon ball={b} size={64} />
              <div className="font-display text-[19px] font-bold">{BALLS[b].name}</div>
              <div className="font-display text-[24px] leading-none font-bold">{money(CONFIG.balls.cost[b])}</div>
              <div className="text-[13.5px] text-ink-soft">{BALLS[b].hint}</div>
              <button
                className="btn btn-primary mt-1 w-full"
                disabled={!check.ok}
                onClick={() => onAction({ type: 'BUY_BALL', ball: b })}
              >
                {check.ok ? 'Buy' : ballBlockText(check.reason!)}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[13.5px] text-ink-soft">
        The shop closes when you roll. {BALLS.master.name}s are bought on the spot when you land, for the tile's price.
      </p>
    </Modal>
  );
}
