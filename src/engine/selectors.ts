// Read-only rule queries: fees, values, legality. The UI asks these; it never decides rules itself.

import { CONFIG } from '../data/config';
import { CLASSIC_BOARD, NEUTRAL_TYPE, SHOP_BALLS, STARTERS, type BallKind, type Form, type ThrowBall, type TypeId } from '../data/theme';
import { canProtect, typeMultiplier } from './battle';
import type { Action, BoardTile, FighterRef, GameState, PendingTrade, Phase, PlayerId, TradeOffer, TradeSide } from './types';

// The skeleton (corner positions, board length) is fixed for every board; only creature tiles vary.
export const BOARD_SIZE = CLASSIC_BOARD.length;
export const GO_TILE = CLASSIC_BOARD.findIndex((t) => t.kind === 'go');
export const HIDEOUT_TILE = CLASSIC_BOARD.findIndex((t) => t.kind === 'hideout');

/** Anything that carries this game's board (a GameState does). */
export type HasBoard = { board: BoardTile[] };

// ── Tiles ────────────────────────────────────────────────────────────────────

export function isProperty(s: HasBoard, i: number): boolean {
  const k = s.board[i].kind;
  return k === 'pokemon' || k === 'legendary';
}

export function isLegendary(s: HasBoard, i: number): boolean {
  return s.board[i].kind === 'legendary';
}

/** Prices belong to the tile's slot (by tile index), not to the creature on it. */
export function tilePrice(s: HasBoard, i: number): number {
  if (isLegendary(s, i)) return CONFIG.legendary.price;
  return CONFIG.propertyPrices[i] ?? 0;
}

export function levelCost(s: HasBoard, i: number): number {
  return Math.round(tilePrice(s, i) * CONFIG.levelCostRatio);
}

/** The other tile of the same pair slot (legendaries have none). */
export function pairPartner(s: HasBoard, i: number): number | null {
  const slot = s.board[i].slot;
  if (s.board[i].kind !== 'pokemon' || !slot) return null;
  const idx = s.board.findIndex((t, j) => j !== i && t.kind === 'pokemon' && t.slot === slot);
  return idx >= 0 ? idx : null;
}

export function ownsPair(s: GameState, pid: PlayerId, i: number): boolean {
  const p = pairPartner(s, i);
  return p !== null && s.tiles[i].owner === pid && s.tiles[p].owner === pid;
}

export function stageForLevel(level: number): number {
  return CONFIG.evolutionLevels.filter((l) => level >= l).length;
}

export function formAtLevel(s: HasBoard, i: number, level: number): Form {
  const forms = s.board[i].forms!;
  return forms[Math.min(stageForLevel(level), forms.length - 1)];
}

export function tileForm(s: GameState, i: number): Form {
  return formAtLevel(s, i, s.tiles[i].level);
}

export function tileType(s: HasBoard, i: number): TypeId {
  return s.board[i].type!;
}

export function legendaryCount(s: GameState, pid: PlayerId): number {
  return s.tiles.filter((t, i) => t.owner === pid && isLegendary(s, i)).length;
}

/** Fee for a regular tile at a given level, or for a legendary given the owner's legendary count. */
export function feeAt(s: HasBoard, i: number, level: number, legendaries = 1): number {
  if (isLegendary(s, i)) return CONFIG.legendary.feeByCount[legendaries] ?? 0;
  return Math.round(tilePrice(s, i) * (CONFIG.feeByLevel[level] ?? 0));
}

/** Current fee for landing on tile i (for unowned tiles: the fee it would have at start level). */
export function tileFee(s: GameState, i: number): number {
  const t = s.tiles[i];
  const legends = t.owner === null ? 1 : legendaryCount(s, t.owner);
  return feeAt(s, i, t.level, legends);
}

export function battleLevelOfTile(s: GameState, i: number): number {
  return isLegendary(s, i) ? CONFIG.legendary.battleLevel : s.tiles[i].level;
}

export function ownedTiles(s: GameState, pid: PlayerId): number[] {
  const out: number[] = [];
  s.tiles.forEach((t, i) => {
    if (t.owner === pid) out.push(i);
  });
  return out;
}

/** Everything invested in a tile: price + level-ups (valued at level cost). */
export function investedIn(s: GameState, i: number): number {
  if (isLegendary(s, i)) return tilePrice(s, i);
  return tilePrice(s, i) + (s.tiles[i].level - CONFIG.startLevel) * levelCost(s, i);
}

export function releaseValue(s: GameState, i: number): number {
  return Math.round(investedIn(s, i) * CONFIG.liquidationRatio);
}

export function netWorth(s: GameState, pid: PlayerId): number {
  const p = s.players[pid];
  if (p.bankrupt) return 0;
  const tiles = ownedTiles(s, pid).reduce((sum, i) => sum + investedIn(s, i), 0);
  const starter = (p.starterLevel - CONFIG.startLevel) * CONFIG.starter.levelCost;
  return p.cash + tiles + starter;
}

// ── Players ──────────────────────────────────────────────────────────────────

export function alivePlayers(s: GameState): PlayerId[] {
  return s.players.filter((p) => !p.bankrupt).map((p) => p.id);
}

/** Final standings: survivors by net worth, then bankrupt players (last out ranks lowest). */
export function ranking(s: GameState): PlayerId[] {
  const alive = alivePlayers(s).sort((a, b) => netWorth(s, b) - netWorth(s, a) || a - b);
  const out = [...s.bankruptOrder].reverse();
  if (s.winner !== null && alive.includes(s.winner)) {
    return [s.winner, ...alive.filter((p) => p !== s.winner), ...out];
  }
  return [...alive, ...out];
}

// ── Fighters ─────────────────────────────────────────────────────────────────

export interface FighterInfo {
  ref: FighterRef;
  name: string;
  dex: number;
  type: TypeId;
  level: number;
  tile: number | null;
}

export function fightersOf(s: GameState, pid: PlayerId): FighterRef[] {
  return [{ kind: 'starter' }, ...ownedTiles(s, pid).map((tile) => ({ kind: 'tile', tile }) as FighterRef)];
}

export function fighterInfo(s: GameState, pid: PlayerId, ref: FighterRef): FighterInfo {
  if (ref.kind === 'starter') {
    const p = s.players[pid];
    const f = STARTERS[p.starter];
    return { ref, name: f.name, dex: f.dex, type: NEUTRAL_TYPE, level: p.starterLevel, tile: null };
  }
  const f = tileForm(s, ref.tile);
  return { ref, name: f.name, dex: f.dex, type: tileType(s, ref.tile), level: battleLevelOfTile(s, ref.tile), tile: ref.tile };
}

export function gruntLevel(round: number): number {
  return Math.min(CONFIG.grunt.maxLevel, Math.ceil(round / CONFIG.grunt.roundsPerLevel));
}

/** The opponent the current challenge would put up (type + level), for matchup previews. */
export function challengeOpponent(s: GameState): { type: TypeId; level: number } | null {
  if (s.phase === 'feeChoice' && s.pendingTile !== null) {
    return { type: tileType(s, s.pendingTile), level: battleLevelOfTile(s, s.pendingTile) };
  }
  if (s.phase === 'ambushChoice' || s.phase === 'hideout') {
    return { type: NEUTRAL_TYPE, level: gruntLevel(s.round) };
  }
  return null;
}

/**
 * What the current fee / ambush decision costs: `pay` if you pay now, `loseBattle` if you
 * battle and lose (pay × (1 + battleLossSurcharge), rounded). Winning a battle costs nothing.
 */
/** What losing a battle costs, for a decision whose plain fee is `pay`. */
export function lossCost(pay: number): number {
  return Math.round(pay * (1 + CONFIG.battleLossSurcharge));
}

export function challengeCosts(s: GameState): { pay: number; loseBattle: number } | null {
  let pay: number;
  if (s.phase === 'feeChoice' && s.pendingTile !== null) pay = tileFee(s, s.pendingTile);
  else if (s.phase === 'ambushChoice') pay = CONFIG.ambushFee;
  else return null;
  return { pay, loseBattle: lossCost(pay) };
}

// ── Level-ups ────────────────────────────────────────────────────────────────

export type LevelBlock = 'notOwner' | 'legendary' | 'maxLevel' | 'needPair' | 'cash';

export interface LevelCheck {
  ok: boolean;
  cost: number;
  reason: LevelBlock | null;
}

/** Can `pid` level this fighter? `ignoreCash` checks only caps (used by Rare Candy). */
export function levelUpCheck(s: GameState, pid: PlayerId, ref: FighterRef, ignoreCash = false): LevelCheck {
  const p = s.players[pid];
  if (ref.kind === 'starter') {
    const cost = CONFIG.starter.levelCost;
    if (p.starterLevel >= CONFIG.starter.maxLevel) return { ok: false, cost, reason: 'maxLevel' };
    if (!ignoreCash && p.cash < cost) return { ok: false, cost, reason: 'cash' };
    return { ok: true, cost, reason: null };
  }
  const i = ref.tile;
  const cost = levelCost(s, i);
  if (s.tiles[i].owner !== pid) return { ok: false, cost, reason: 'notOwner' };
  if (isLegendary(s, i)) return { ok: false, cost, reason: 'legendary' };
  const lvl = s.tiles[i].level;
  if (lvl >= CONFIG.maxLevel) return { ok: false, cost, reason: 'maxLevel' };
  if (lvl >= CONFIG.setRuleCap && !ownsPair(s, pid, i)) return { ok: false, cost, reason: 'needPair' };
  if (!ignoreCash && p.cash < cost) return { ok: false, cost, reason: 'cash' };
  return { ok: true, cost, reason: null };
}

const MANAGE_PHASES = new Set(['roll', 'hideout', 'buy', 'endTurn']);

export function canManage(s: GameState): boolean {
  return MANAGE_PHASES.has(s.phase);
}

// ── Who acts ─────────────────────────────────────────────────────────────────

/** Player who must act now. null = a grunt (always bot-controlled). */
export function actorOf(s: GameState): PlayerId | null {
  switch (s.phase) {
    case 'battle': {
      const b = s.battle!;
      return b.sides[b.turn].owner;
    }
    case 'battleOver': {
      const b = s.battle!;
      // Whoever is human gets to press Continue; attacker first.
      const att = b.sides[1].owner!;
      const def = b.sides[0].owner;
      if (!s.players[att].isBot) return att;
      if (def !== null && !s.players[def].isBot) return def;
      return att;
    }
    case 'debt':
      return s.debt!.debtor;
    case 'trade':
      return s.pendingTrade!.answerer ?? s.pendingTrade!.to;
    default:
      return s.current;
  }
}

export function isBotControlled(s: GameState): boolean {
  if (s.phase === 'gameOver') return false;
  const a = actorOf(s);
  return a === null || s.players[a].isBot;
}

/** True if no human is involved in the current battle (resolve instantly in the UI). */
export function battleIsAllBots(s: GameState): boolean {
  const b = s.battle;
  if (!b) return false;
  return b.sides.every((c) => c.owner === null || s.players[c.owner].isBot);
}

// ── Balls ────────────────────────────────────────────────────────────────────

export function ballPower(ball: BallKind): number {
  return CONFIG.balls.cost[ball] * CONFIG.balls.powerMultiplier;
}

/** Chance (0-1) that this ball catches the creature on tile i. The Master Ball always catches. */
export function catchChance(s: HasBoard, i: number, ball: ThrowBall): number {
  if (ball === 'master') return 1;
  const ratio = ballPower(ball) / tilePrice(s, i);
  return Math.min(CONFIG.balls.maxChance, ratio * (isLegendary(s, i) ? CONFIG.balls.legendaryMultiplier : 1));
}

/** What a throw costs right now: the Master Ball costs the tile price, carried balls were prepaid. */
export function masterBallCost(s: HasBoard, i: number): number {
  return tilePrice(s, i);
}

export function ballsCarried(s: GameState, pid: PlayerId): number {
  const b = s.players[pid].balls;
  return b.poke + b.great + b.ultra;
}

/** The shop is open at the start of your turn, until you roll or make the hideout choice. */
export function shopOpen(s: GameState): boolean {
  return (s.phase === 'roll' || s.phase === 'hideout') && !s.shopClosed;
}

export type BallBlock = 'closed' | 'bagFull' | 'cash';

export function ballBuyCheck(s: GameState, ball: BallKind): { ok: boolean; reason: BallBlock | null } {
  if (!shopOpen(s)) return { ok: false, reason: 'closed' };
  if (ballsCarried(s, s.current) >= CONFIG.balls.carryLimit) return { ok: false, reason: 'bagFull' };
  if (s.players[s.current].cash < CONFIG.balls.cost[ball]) return { ok: false, reason: 'cash' };
  return { ok: true, reason: null };
}

// ── Trading ──────────────────────────────────────────────────────────────────

/** Offers can be made on your own turn before rolling (or in the hideout) and before ending it. */
const TRADE_PHASES = new Set<Phase>(['roll', 'hideout', 'endTurn']);

export type TradeBlock = 'phase' | 'used' | 'noPartner' | 'player' | 'tiles' | 'money' | 'empty' | 'final' | 'same';

/** Can the current player make an offer right now (to anyone)? */
export function canTrade(s: GameState): { ok: boolean; reason: TradeBlock | null } {
  if (!TRADE_PHASES.has(s.phase)) return { ok: false, reason: 'phase' };
  if (s.tradeOffers >= CONFIG.trade.offersPerTurn) return { ok: false, reason: 'used' };
  if (alivePlayers(s).length < 2) return { ok: false, reason: 'noPartner' };
  return { ok: true, reason: null };
}

/** Tradeable creatures: every tile creature the player owns, legendaries included (never starters). */
export function tradeableTiles(s: GameState, pid: PlayerId): number[] {
  return ownedTiles(s, pid).filter((i) => isProperty(s, i));
}

function sideProblem(s: GameState, pid: PlayerId, side: TradeSide): TradeBlock | null {
  // Only creature tiles and money can be traded (no starters, balls or cards): nothing else is accepted.
  if (!side || !Array.isArray(side.tiles) || typeof side.money !== 'number') return 'tiles';
  if (Object.keys(side).some((k) => k !== 'tiles' && k !== 'money')) return 'tiles';
  const tiles = side.tiles;
  if (new Set(tiles).size !== tiles.length) return 'tiles';
  for (const i of tiles) {
    if (!Number.isInteger(i) || i < 0 || i >= s.tiles.length || !isProperty(s, i) || s.tiles[i].owner !== pid) return 'tiles';
  }
  if (!Number.isInteger(side.money) || side.money < 0 || side.money > s.players[pid].cash) return 'money';
  return null;
}

const OFFER_KEYS = new Set(['type', 'by', 'to', 'give', 'receive']);

const givesSomething =(side: TradeSide) => side.tiles.length > 0 || side.money > 0;

/** Full validation of an offer from the current player. All trade rules live here, not in the UI. */
export function tradeCheck(s: GameState, offer: TradeOffer): { ok: boolean; reason: TradeBlock | null } {
  const can = canTrade(s);
  if (!can.ok) return can;
  const { to } = offer;
  if (Object.keys(offer).some((k) => !OFFER_KEYS.has(k))) return { ok: false, reason: 'tiles' };
  if (!Number.isInteger(to) || to < 0 || to >= s.players.length || to === s.current || s.players[to].bankrupt) {
    return { ok: false, reason: 'player' };
  }
  const problem = sideProblem(s, s.current, offer.give) ?? sideProblem(s, to, offer.receive);
  if (problem) return { ok: false, reason: problem };
  if (!givesSomething(offer.give) || !givesSomething(offer.receive)) return { ok: false, reason: 'empty' };
  return { ok: true, reason: null };
}

const SIDE_SORT = (x: TradeSide) => ({ tiles: [...x.tiles].sort((a, b) => a - b), money: x.money });
const sameSides = (a: { give: TradeSide; receive: TradeSide }, b: { give: TradeSide; receive: TradeSide }) =>
  JSON.stringify([SIDE_SORT(a.give), SIDE_SORT(a.receive)]) === JSON.stringify([SIDE_SORT(b.give), SIDE_SORT(b.receive)]);

/** Proposals in the open negotiation so far (1 = the first offer). */
export function proposalNumber(t: PendingTrade): number {
  return (t.history?.length ?? 0) + 1;
}

/** The pending proposal from `pid`'s side: what they give and what they get. */
export function tradeSidesFor(t: TradeOffer & { from: PlayerId }, pid: PlayerId): { give: TradeSide; receive: TradeSide } {
  return pid === t.from ? { give: t.give, receive: t.receive } : { give: t.receive, receive: t.give };
}

const COUNTER_KEYS = new Set(['type', 'by', 'give', 'receive']);

/**
 * Validation of a counter from the player who must answer: same rules as any offer, while the
 * proposal limit allows, and it must differ from the proposal it answers. give/receive are from the
 * countering player's side.
 */
export function counterCheck(s: GameState, counter: { give: TradeSide; receive: TradeSide }): { ok: boolean; reason: TradeBlock | null } {
  const t = s.pendingTrade;
  if (s.phase !== 'trade' || !t) return { ok: false, reason: 'phase' };
  if (proposalNumber(t) >= CONFIG.trade.maxProposals) return { ok: false, reason: 'final' };
  if (Object.keys(counter).some((k) => !COUNTER_KEYS.has(k))) return { ok: false, reason: 'tiles' };
  const me = t.answerer;
  const other = me === t.from ? t.to : t.from;
  const problem = sideProblem(s, me, counter.give) ?? sideProblem(s, other, counter.receive);
  if (problem) return { ok: false, reason: problem };
  if (!givesSomething(counter.give) || !givesSomething(counter.receive)) return { ok: false, reason: 'empty' };
  if (sameSides(counter, tradeSidesFor(t, me))) return { ok: false, reason: 'same' };
  return { ok: true, reason: null };
}

/** Checked again when the offer is accepted: both sides still own the creatures and have the money. */
export function tradeStillValid(s: GameState, t: PendingTrade): boolean {
  return sideProblem(s, t.from, t.give) === null && sideProblem(s, t.to, t.receive) === null;
}

// ── Legal actions ────────────────────────────────────────────────────────────

function levelUps(s: GameState): Action[] {
  const pid = s.current;
  return fightersOf(s, pid)
    .filter((ref) => levelUpCheck(s, pid, ref).ok)
    .map((target) => ({ type: 'LEVEL_UP', target }));
}

function shopBuys(s: GameState): Action[] {
  return SHOP_BALLS.filter((ball) => ballBuyCheck(s, ball).ok).map((ball) => ({ type: 'BUY_BALL', ball }));
}

function battles(s: GameState): Action[] {
  return fightersOf(s, s.current).map((fighter) => ({ type: 'BATTLE', fighter }));
}

export function legalActions(s: GameState): Action[] {
  const p = s.players[s.current];
  switch (s.phase) {
    case 'roll':
      return [{ type: 'ROLL' }, ...shopBuys(s), ...levelUps(s)];
    case 'hideout': {
      const out: Action[] = [...battles(s), { type: 'PAY' }];
      if (p.escapeRopes > 0) out.push({ type: 'USE_ROPE' });
      return [...out, ...shopBuys(s), ...levelUps(s)];
    }
    case 'buy': {
      // One throw per landing: this phase ends after any throw (caught or not).
      const out: Action[] = SHOP_BALLS.filter((ball) => p.balls[ball] > 0).map((ball) => ({ type: 'THROW', ball }));
      if (p.cash >= masterBallCost(s, s.pendingTile!)) out.push({ type: 'THROW', ball: 'master' });
      return [...out, { type: 'SKIP' }, ...levelUps(s)];
    }
    case 'feeChoice':
    case 'ambushChoice':
      return [...battles(s), { type: 'PAY' }];
    case 'card':
    case 'battleOver':
      return [{ type: 'ACK' }];
    case 'battle': {
      const b = s.battle!;
      const me = b.sides[b.turn];
      const out: Action[] = [
        { type: 'MOVE', move: 'tackle' },
        { type: 'MOVE', move: 'type' },
      ];
      if (canProtect(me)) out.push({ type: 'MOVE', move: 'protect' });
      return out;
    }
    case 'debt':
      return ownedTiles(s, s.debt!.debtor).map((tile) => ({ type: 'RELEASE', tile }));
    case 'trade':
      return [
        { type: 'RESPOND_TRADE', accept: true },
        { type: 'RESPOND_TRADE', accept: false },
      ];
    case 'endTurn':
      return [{ type: 'END_TURN' }, ...levelUps(s)];
    case 'gameOver':
      return [];
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function sameAction(a: Action, b: Action): boolean {
  return deepEqual(a, b);
}

/** Legal for whoever is acting now. If the action names who is taking it (`by`), it must be them. */
export function isLegal(s: GameState, a: Action): boolean {
  const { by, ...body } = a;
  if (by !== undefined && by !== actorOf(s)) return false;
  // Offers can't be listed one by one; they are checked directly.
  if (body.type === 'PROPOSE_TRADE') return tradeCheck(s, body).ok;
  if (body.type === 'COUNTER_TRADE') return counterCheck(s, body).ok;
  return legalActions(s).some((l) => sameAction(l, body as Action));
}

export { typeMultiplier };
