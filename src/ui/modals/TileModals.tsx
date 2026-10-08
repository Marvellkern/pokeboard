import { CONFIG } from '../../data/config';
import { BALLS, SHOP_BALLS, TYPES, WORDS } from '../../data/theme';
import {
  catchChance,
  feeAt,
  masterBallCost,
  lossCost,
  formAtLevel,
  isLegendary,
  isProperty,
  legendaryCount,
  levelCost,
  pairPartner,
  tileForm,
} from '../../engine/selectors';
import type { GameState } from '../../engine/types';
import { PropertyCard, SpecialCard } from '../cards';
import { Modal, PlayerName } from '../common';
import { chanceText, money } from '../format';
import { BallIcon } from '../icons';

const DESCRIPTIONS: Record<string, string> = {
  go: `Collect ${money(CONFIG.goPayout)} every time you pass or land here.`,
  card: 'Draw a card.',
  hideout: `Just visiting, unless you were sent here. Escape by beating the guard, paying ${money(CONFIG.hideout.fee)}, or using an ${WORDS.escapeRope}.`,
  bonus: `Collect ${money(CONFIG.bonusTilePayout)}.`,
  safari: 'Nothing happens here.',
  ambush: `Battle a ${WORDS.grunt}. Skip it: pay ${money(CONFIG.ambushFee)}. Battle and lose: pay ${money(lossCost(CONFIG.ambushFee))}. Both go to the bank.`,
  goToHideout: `Go straight to the ${WORDS.hideout}. No start money.`,
};

function PropertyDetails({ game, tile }: { game: GameState; tile: number }) {
  const def = game.board[tile];
  const t = game.tiles[tile];
  const owner = t.owner !== null ? game.players[t.owner] : null;
  const legendary = isLegendary(game, tile);
  const partner = pairPartner(game, tile);
  const partnerOwner = partner !== null && game.tiles[partner].owner !== null ? game.players[game.tiles[partner].owner!] : null;
  const row = (active: boolean) => (active ? 'bg-yellow font-black' : '');

  return (
    <div className="flex flex-col gap-4">
      <PropertyCard game={game} tile={tile} fixed />
      <div className="rounded-2xl border-[3px] border-ink px-3 py-2">
        <div className="mb-1 text-[13px] font-extrabold text-ink-soft">Catch chance on this tile</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {([...SHOP_BALLS, 'master'] as const).map((b) => (
            <span key={b} className="font-display inline-flex items-center gap-1 text-[15px] font-semibold">
              <BallIcon ball={b} size={20} />
              {BALLS[b].name} {chanceText(catchChance(game, tile, b))}
              {b === 'master' && <span className="text-ink-soft">({money(masterBallCost(game, tile))})</span>}
            </span>
          ))}
        </div>
      </div>
      {legendary ? (
        <div className="text-[15px]">
          <p>
            Can't be leveled. Always fights at Lv {CONFIG.legendary.battleLevel}. The fee grows with how many{' '}
            {WORDS.legendary} {WORDS.creatures} the owner holds:
          </p>
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="px-2">{WORDS.legendary} owned</th>
                <th className="px-2">Fee</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: game.board.filter((d) => d.kind === 'legendary').length }, (_, k) => k + 1).map((n) => (
                <tr key={n} className={row(!!owner && legendaryCount(game, owner.id) === n)}>
                  <td className="px-2 py-0.5">{n}</td>
                  <td className="font-display px-2 py-0.5">{money(feeAt(game, tile, 1, n))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[15px]">
          <table className="w-full">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="px-2">Lv</th>
                <th className="px-2">Form</th>
                <th className="px-2">Fee</th>
                <th className="px-2">HP</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: CONFIG.maxLevel }, (_, k) => k + 1).map((lv) => (
                <tr key={lv} className={row(!!owner && t.level === lv)}>
                  <td className="px-2 py-0.5">{lv}</td>
                  <td className="px-2 py-0.5">{formAtLevel(game, tile, lv).name}</td>
                  <td className="font-display px-2 py-0.5">{money(feeAt(game, tile, lv))}</td>
                  <td className="font-display px-2 py-0.5">{CONFIG.hp.base + CONFIG.hp.perLevel * lv}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3">
            Level-up: <b className="font-display">{money(levelCost(game, tile))}</b> per level. Above Lv {CONFIG.setRuleCap} needs
            both {TYPES[def.type!].name} {WORDS.creatures}.
          </p>
          {partner !== null && (
            <p className="mt-1">
              Pair partner: <b>{game.board[partner].name}</b> ({partnerOwner ? <PlayerName player={partnerOwner} /> : 'wild'})
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function TileInfoModal({ game, tile, onClose }: { game: GameState; tile: number; onClose: () => void }) {
  const def = game.board[tile];
  const name = isProperty(game, tile) ? tileForm(game, tile).name : def.name;
  const here = game.players.filter((p) => !p.bankrupt && p.position === tile);
  return (
    <Modal title={name} onClose={onClose}>
      {isProperty(game, tile) ? (
        <PropertyDetails game={game} tile={tile} />
      ) : (
        <SpecialCard kind={def.kind} title={def.name} fixed>
          {DESCRIPTIONS[def.kind]}
        </SpecialCard>
      )}
      {here.length > 0 && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-[15px]">
          Here now:
          {here.map((p) => (
            <PlayerName key={p.id} player={p} />
          ))}
        </p>
      )}
    </Modal>
  );
}
