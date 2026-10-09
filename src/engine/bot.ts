// Simple, predictable bot: chooseAction(state) -> Action for whoever must act now.

import { CONFIG } from '../data/config';
import { canProtect, damageRange, typeMultiplier } from './battle';
import { peekFloat } from './rng';
import {
  ballBuyCheck,
  ballsCarried,
  alivePlayers,
  canTrade,
  catchChance,
  challengeCosts,
  isLegendary,
  legendaryCount,
  levelCost,
  ownsPair,
  tilePrice,
  tradeCheck,
  masterBallCost,
  shopOpen,
  challengeOpponent,
  fighterInfo,
  fightersOf,
  levelUpCheck,
  ownedTiles,
  pairPartner,
  tileFee,
  type FighterInfo,
} from './selectors';
import { afterTrade, sameOffer, tradeEffects, type Trade } from './trade';
import type { Action, FighterRef, GameState, PlayerId, TradeOffer } from './types';
import { SHOP_BALLS, type BallKind, type TypeId } from '../data/theme';

/** Fee a fighter earns (starters earn none). */
function fighterFee(s: GameState, ref: FighterRef): number {
  return ref.kind === 'tile' ? tileFee(s, ref.tile) : 0;
}

/** Next level-up to buy while cash is above the reserve, or null. */
function wantedLevelUp(s: GameState, pid: PlayerId): Action | null {
  if (s.players[pid].cash <= CONFIG.bot.levelReserve) return null;
  const options = fightersOf(s, pid)
    .filter((ref) => levelUpCheck(s, pid, ref).ok)
    .sort((a, b) => fighterFee(s, b) - fighterFee(s, a));
  return options.length > 0 ? { type: 'LEVEL_UP', target: options[0] } : null;
}

/** Best fighter vs an opponent type: best type multiplier, then highest level. */
export function bestFighter(s: GameState, pid: PlayerId, oppType: TypeId): FighterInfo {
  const all = fightersOf(s, pid).map((ref) => fighterInfo(s, pid, ref));
  all.sort(
    (a, b) => typeMultiplier(b.type, oppType) - typeMultiplier(a.type, oppType) || b.level - a.level,
  );
  return all[0];
}

/** Estimated win chance from the matchup and level difference (lookup table in config). */
function winChance(attType: TypeId, attLevel: number, oppType: TypeId, oppLevel: number): number {
  const m = typeMultiplier(attType, oppType);
  const table = CONFIG.bot.winChance[m > 1 ? 'advantage' : m < 1 ? 'disadvantage' : 'neutral'];
  const diff = Math.max(-4, Math.min(4, attLevel - oppLevel));
  return table[diff] ?? 0;
}

/** Battle when the expected saving beats the expected surcharge: w × fee > (1 − w) × fee × surcharge. */
function battleOrPay(s: GameState): Action {
  const opp = challengeOpponent(s)!;
  const best = bestFighter(s, s.current, opp.type);
  const w = winChance(best.type, best.level, opp.type, opp.level);
  const fee = challengeCosts(s)!.pay;
  if (w * fee > (1 - w) * fee * CONFIG.battleLossSurcharge) return { type: 'BATTLE', fighter: best.ref };
  return { type: 'PAY' };
}

function chooseMove(s: GameState): Action {
  const b = s.battle!;
  const me = b.sides[b.turn];
  const foe = b.sides[b.turn === 0 ? 1 : 0];
  const tackle = damageRange(me, foe, 'tackle');
  const type = damageRange(me, foe, 'type');

  // Guaranteed knock-out?
  if (type.min >= foe.hp || tackle.min >= foe.hp) {
    return { type: 'MOVE', move: type.min >= tackle.min ? 'type' : 'tackle' };
  }
  const roll = peekFloat(s.rng, b.moves * 7 + b.turn);
  if (canProtect(me) && me.hp / me.maxHp > CONFIG.bot.protectHpRatio && roll < CONFIG.bot.protectChance) {
    return { type: 'MOVE', move: 'protect' };
  }
  const resisted = typeMultiplier(me.type, foe.type) < 1;
  return { type: 'MOVE', move: resisted ? 'tackle' : 'type' };
}

/** Shop, before rolling: one ball at most per turn, only when running low. */
function wantedBall(s: GameState): Action | null {
  if (!shopOpen(s) || s.shopBuys > 0 || ballsCarried(s, s.current) >= CONFIG.bot.shopBelowBalls) return null;
  const cash = s.players[s.current].cash;
  const ball: BallKind | null = cash >= CONFIG.bot.shopGreatCash ? 'great' : cash >= CONFIG.bot.shopPokeCash ? 'poke' : null;
  return ball && ballBuyCheck(s, ball).ok ? { type: 'BUY_BALL', ball } : null;
}

/** Unowned tile: first rule that applies. */
function chooseThrow(s: GameState): Action {
  const pid = s.current;
  const p = s.players[pid];
  const i = s.pendingTile!;
  const masterLeft = p.cash - masterBallCost(s, i);
  const partner = pairPartner(s, i);
  const completesPair = partner !== null && s.tiles[partner].owner === pid;
  // 1. Completes a pair and the Master Ball leaves enough cash.
  if (completesPair && masterLeft >= CONFIG.bot.masterPairReserve) return { type: 'THROW', ball: 'master' };
  const carried = SHOP_BALLS.filter((b) => p.balls[b] > 0);
  // 2. Cheapest carried ball with a good chance.
  const good = carried.filter((b) => catchChance(s, i, b) >= CONFIG.bot.goodThrowChance);
  if (good.length) return { type: 'THROW', ball: good.sort((a, b) => CONFIG.balls.cost[a] - CONFIG.balls.cost[b])[0] };
  // 3. Master Ball if it leaves a comfortable reserve.
  if (masterLeft >= CONFIG.bot.masterReserve) return { type: 'THROW', ball: 'master' };
  // 4. Best carried ball.
  if (carried.length) return { type: 'THROW', ball: carried.sort((a, b) => catchChance(s, i, b) - catchChance(s, i, a))[0] };
  // 5. Skip.
  return { type: 'SKIP' };
}

// ── Trading ──────────────────────────────────────────────────────────────────

const T = () => CONFIG.bot.trade;

/** What tile i is worth to pid in state st: its price (× pairMultiplier if pid holds its pair); legendaries by count. */
function tileWorth(st: GameState, i: number, pid: PlayerId): number {
  if (isLegendary(st, i)) return CONFIG.legendary.price * (1 + T().legendaryStep * legendaryCount(st, pid));
  return tilePrice(st, i) * (ownsPair(st, pid, i) ? T().pairMultiplier : 1);
}

/** How a trade looks to one of its two players: value received vs value given up. */
export function tradeValue(s: GameState, t: Trade, pid: PlayerId): { received: number; given: number } {
  const after = afterTrade(s, t);
  const effects = tradeEffects(s, t, t.from);
  const mine = pid === t.from;
  const got = mine ? t.receive : t.give;
  const gave = mine ? t.give : t.receive;
  const other = mine ? t.to : t.from;
  const completesMine = effects.some((e) => e.kind === 'pairCompleted' && e.player === pid);

  const received = got.money + got.tiles.reduce((sum, i) => sum + tileWorth(after, i, pid), 0);
  let given = gave.money;
  for (const i of gave.tiles) {
    // The tile as it is now (× pairMultiplier when giving it breaks a pair), plus the levels lost on reset.
    given += tileWorth(s, i, pid);
    if (!isLegendary(s, i)) given += (s.tiles[i].level - CONFIG.startLevel) * levelCost(s, i);
    // Danger: handing the other player a complete pair, unless this trade completes one for the bot too.
    if (!completesMine && !isLegendary(s, i) && ownsPair(after, other, i)) given += T().dangerPremium * tilePrice(s, i);
  }
  // Levels lost on kept partners dropping back to the cap.
  for (const e of effects) if (e.kind === 'pairBroken' && e.player === pid) given += e.lost;
  return { received, given };
}

/** Bots accept when what they get is worth at least acceptRatio × what they give. */
export function botAccepts(s: GameState, t: Trade, pid: PlayerId): boolean {
  const v = tradeValue(s, t, pid);
  return v.received >= v.given * T().acceptRatio;
}

/** The same offer was declined by the same player recently. */
function recentlyDeclined(s: GameState, from: PlayerId, offer: TradeOffer): boolean {
  return s.tradeDeclines.some(
    (d) => d.from === from && d.to === offer.to && s.round - d.round < CONFIG.trade.declineMemoryRounds && sameOffer(d, offer),
  );
}

/** Regular tiles `owner` holds whose pair partner `partnerOwner` holds. */
function completers(s: GameState, owner: PlayerId, partnerOwner: PlayerId): number[] {
  return s.tiles.flatMap((t, i) => {
    const j = pairPartner(s, i);
    return t.owner === owner && j !== null && s.tiles[j].owner === partnerOwner ? [i] : [];
  });
}

/**
 * Before rolling, at most one offer per turn; the first match wins.
 * 1. Pair swap: a tile that completes their pair for one that completes ours; whoever gets the
 *    pricier tile adds half the price difference in cash.
 * 2. Cash buy, from players we can't swap with: cashBuyMultiplier × price, keeping cashBuyReserve.
 */
function wantedTrade(s: GameState): Action | null {
  if (!canTrade(s).ok) return null;
  const me = s.current;
  const cash = s.players[me].cash;
  const others = alivePlayers(s).filter((q) => q !== me);
  const byPrice = (a: number, b: number) => tilePrice(s, b) - tilePrice(s, a) || a - b;
  const propose = (o: TradeOffer): Action | null =>
    !recentlyDeclined(s, me, o) && tradeCheck(s, o).ok ? { type: 'PROPOSE_TRADE', ...o } : null;
  const swapsWith = (q: PlayerId) => {
    const wants = completers(s, q, me).sort(byPrice);
    const mine = completers(s, me, q).sort(byPrice);
    // Swapping the two tiles of one slot would complete nothing.
    return wants.flatMap((w) => mine.filter((m) => pairPartner(s, w) !== m).map((m) => [w, m] as const));
  };

  for (const q of others) {
    for (const [want, mine] of swapsWith(q)) {
      const diff = tilePrice(s, want) - tilePrice(s, mine);
      const half = Math.round(Math.abs(diff) / 2);
      const a = propose({
        to: q,
        give: { tiles: [mine], money: diff > 0 ? Math.min(half, cash) : 0 },
        receive: { tiles: [want], money: diff < 0 ? Math.min(half, s.players[q].cash) : 0 },
      });
      if (a) return a;
    }
  }
  for (const q of others) {
    if (swapsWith(q).length > 0) continue;
    for (const want of completers(s, q, me).sort(byPrice)) {
      const amount = Math.round(tilePrice(s, want) * T().cashBuyMultiplier);
      if (cash - amount < T().cashBuyReserve) continue;
      const a = propose({ to: q, give: { tiles: [], money: amount }, receive: { tiles: [want], money: 0 } });
      if (a) return a;
    }
  }
  return null;
}

export function chooseAction(s: GameState): Action {
  const pid = s.current;
  const p = s.players[pid];
  switch (s.phase) {
    case 'roll':
      return wantedTrade(s) ?? wantedBall(s) ?? wantedLevelUp(s, pid) ?? { type: 'ROLL' };

    case 'trade': {
      const t = s.pendingTrade!;
      return { type: 'RESPOND_TRADE', accept: botAccepts(s, t, t.to) };
    }

    case 'endTurn':
      return wantedLevelUp(s, pid) ?? { type: 'END_TURN' };

    case 'buy':
      return chooseThrow(s);

    case 'feeChoice':
    case 'ambushChoice':
      return battleOrPay(s);

    case 'hideout': {
      const pre = wantedTrade(s) ?? wantedBall(s);
      if (pre) return pre;
      if (p.escapeRopes > 0) return { type: 'USE_ROPE' };
      const opp = challengeOpponent(s)!;
      const best = bestFighter(s, pid, opp.type);
      if (best.level >= opp.level) return { type: 'BATTLE', fighter: best.ref };
      return { type: 'PAY' };
    }

    case 'battle':
      return chooseMove(s);

    case 'card':
    case 'battleOver':
      return { type: 'ACK' };

    case 'debt': {
      const debtor = s.debt!.debtor;
      const tiles = ownedTiles(s, debtor).sort((a, b) => tileFee(s, a) - tileFee(s, b) || a - b);
      return { type: 'RELEASE', tile: tiles[0] };
    }

    case 'gameOver':
      throw new Error('Game is over');
  }
}
