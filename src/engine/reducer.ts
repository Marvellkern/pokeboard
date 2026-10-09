// The game engine: reduce(state, action) -> state. Pure, deterministic, serializable.

import { CONFIG } from '../data/config';
import { BALLS, CARD_TEXT, CURRENCY, GRUNTS, NEUTRAL_TYPE, STARTERS, WORDS, type ThrowBall } from '../data/theme';
import { generateBoard } from './board';
import { applyMove, makeCombatant } from './battle';
import { nextFloat, nextInt, seedToState, shuffle } from './rng';
import { applyTrade, normalizeOffer } from './trade';
import {
  BOARD_SIZE,
  GO_TILE,
  HIDEOUT_TILE,
  alivePlayers,
  ballsCarried,
  battleLevelOfTile,
  catchChance,
  masterBallCost,
  challengeCosts,

  fighterInfo,
  formAtLevel,
  gruntLevel,
  isLegal,
  isProperty,

  levelUpCheck,
  ownedTiles,
  netWorth,
  releaseValue,
  stageForLevel,
  tileFee,
  tileForm,
  tilePrice,
  tileType,
  tradeStillValid,
} from './selectors';
import type {
  Action,
  Battle,
  BattleKind,
  Continuation,
  EventMeta,
  FighterRef,
  GameEventType,
  GameSetup,
  GameState,
  PlayerId,
  TradeResult,
  TradeSide,
} from './types';

type PayReason = NonNullable<EventMeta['reason']>;

const money = (n: number) => `${CURRENCY}${n.toLocaleString('en-US')}`;

// ── Setup ────────────────────────────────────────────────────────────────────

export function createGame(setup: GameSetup, seed: number): GameState {
  // The board is generated first, once, before anything else uses the RNG.
  // (Classic mode consumes no randomness, so classic games deal exactly as before.)
  const boardMode = setup.boardMode ?? 'classic';
  const { board, rng } = generateBoard(seedToState(seed), boardMode);
  const s: GameState = {
    version: 1,
    seed,
    rng,
    board,
    boardMode,
    players: setup.players.map((p, id) => ({
      id,
      name: p.name,
      color: p.color,
      isBot: p.isBot,
      starter: p.starter,
      starterLevel: CONFIG.startLevel,
      cash: CONFIG.startingMoney,
      position: GO_TILE,
      inHideout: false,
      hideoutFails: 0,
      escapeRopes: 0,
      bankrupt: false,
      balls: { ...CONFIG.balls.starting },
    })),
    tiles: Array.from({ length: BOARD_SIZE }, () => ({ owner: null, level: CONFIG.startLevel })),
    current: 0,
    round: 1,
    roundLimit: setup.roundLimit,
    phase: 'roll',
    pendingTile: null,
    pendingCard: null,
    deck: [],
    deckPos: 0,
    lastRoll: null,
    rollSeq: 0,
    turnSeq: 0,
    battle: null,
    debt: null,
    log: [],
    logSeq: 0,
    winner: null,
    bankruptOrder: [],
    shopClosed: false,
    shopBuys: 0,
    lastThrow: null,
    pendingTrade: null,
    tradeOffers: 0,
    lastTrade: null,
    tradeDeclines: [],
    events: [],
  };
  s.deck = shuffle(s, CONFIG.cards.map((_, i) => i));
  log(s, `Game started. Round 1 of ${s.roundLimit}. ${s.players[0].name} goes first.`);
  event(s, 'start', null, `Game started: ${s.players.length} players, ${s.roundLimit} rounds.`);
  return s;
}

// ── Reducer ──────────────────────────────────────────────────────────────────

/** Applies an action. Illegal actions return the same state object unchanged. */
export function reduce(state: GameState, action: Action): GameState {
  if (!isLegal(state, action)) return state;
  const s = cloneState(state);
  const p = s.players[s.current];
  // Rolling or making the hideout choice closes the shop for the rest of the turn.
  const keepsShopOpen = action.type === 'BUY_BALL' || action.type === 'LEVEL_UP' || action.type === 'PROPOSE_TRADE';
  if ((s.phase === 'roll' || s.phase === 'hideout') && !keepsShopOpen) {
    s.shopClosed = true;
  }

  switch (action.type) {
    case 'ROLL': {
      const dice = Array.from({ length: CONFIG.dice.count }, () => nextInt(s, 1, CONFIG.dice.sides));
      const total = dice.reduce((a, b) => a + b, 0);
      s.lastRoll = dice;
      s.rollSeq += 1;
      log(s, `${p.name} rolled ${dice.join(' + ')} = ${total}.`);
      const dest = (p.position + total) % BOARD_SIZE;
      event(s, 'roll', s.current, `${p.name} rolled ${total} and landed on ${tileLabel(s, dest)}.`, { dice, tile: dest });
      movePlayer(s, s.current, total, true);
      resolveTile(s);
      break;
    }

    case 'BUY_BALL': {
      p.cash -= CONFIG.balls.cost[action.ball];
      p.balls[action.ball] += 1;
      s.shopBuys += 1;
      note(s, 'ball_purchase', s.current, `${p.name} bought a ${BALLS[action.ball].name} for ${money(CONFIG.balls.cost[action.ball])}.`, { ball: action.ball });
      break;
    }

    case 'THROW': {
      throwBall(s, action.ball);
      break;
    }

    case 'SKIP':
      log(s, `${p.name} passed on ${s.board[s.pendingTile!].name}.`);
      s.pendingTile = null;
      s.phase = 'endTurn';
      break;

    case 'PAY': {
      if (s.phase === 'feeChoice') {
        const i = s.pendingTile!;
        const owner = s.tiles[i].owner!;
        s.pendingTile = null;
        charge(s, s.current, owner, tileFee(s, i), { k: 'endTurn' }, 'fee');
      } else if (s.phase === 'ambushChoice') {
        charge(s, s.current, null, CONFIG.ambushFee, { k: 'endTurn' }, 'ambush');
      } else if (s.phase === 'hideout') {
        p.inHideout = false;
        p.hideoutFails = 0;
        log(s, `${p.name} paid to leave the ${WORDS.hideoutShort}.`);
        charge(s, s.current, null, CONFIG.hideout.fee, { k: 'roll' }, 'hideout');
      }
      break;
    }

    case 'BATTLE':
      startBattle(s, action.fighter);
      break;

    case 'USE_ROPE':
      p.escapeRopes -= 1;
      p.inHideout = false;
      p.hideoutFails = 0;
      log(s, `${p.name} used an ${WORDS.escapeRope} to leave the ${WORDS.hideoutShort}.`);
      s.phase = 'roll';
      break;

    case 'MOVE': {
      const b = s.battle!;
      applyMove(b, action.move, s);
      if (b.winner !== null) s.phase = 'battleOver';
      break;
    }

    case 'ACK':
      if (s.phase === 'card') applyCard(s);
      else if (s.phase === 'battleOver') settleBattle(s);
      break;

    case 'LEVEL_UP':
      levelUp(s, s.current, action.target, false);
      break;

    case 'RELEASE': {
      const d = s.debt!;
      const debtor = s.players[d.debtor];
      const value = releaseValue(s, action.tile);
      const name = tileForm(s, action.tile).name;
      debtor.cash += value;
      s.tiles[action.tile] = { owner: null, level: CONFIG.startLevel };
      note(s, 'release', d.debtor, `${debtor.name} released ${name} for ${money(value)}.`, { tile: action.tile });
      if (debtor.cash >= d.amount || ownedTiles(s, d.debtor).length === 0) {
        s.debt = null;
        charge(s, d.debtor, d.creditor, d.amount, d.then, d.reason ?? 'fee');
      }
      break;
    }

    case 'END_TURN':
      advanceTurn(s);
      break;

    case 'PROPOSE_TRADE': {
      const offer = normalizeOffer(action);
      s.tradeOffers += 1;
      s.pendingTrade = { ...offer, from: s.current, returnPhase: s.phase, answerer: offer.to, history: [] };
      s.phase = 'trade';
      log(s, `${p.name} offered ${s.players[offer.to].name} a trade.`);
      break;
    }

    case 'RESPOND_TRADE':
      respondTrade(s, action.accept);
      break;

    case 'COUNTER_TRADE': {
      const t = s.pendingTrade!;
      const me = t.answerer;
      const other = me === t.from ? t.to : t.from;
      // Stored from the turn player's side, like every proposal.
      const mine = normalizeOffer({ to: other, give: action.give, receive: action.receive });
      const next = me === t.from ? { give: mine.give, receive: mine.receive } : { give: mine.receive, receive: mine.give };
      s.pendingTrade = { ...t, ...next, answerer: other, history: [...t.history, { to: t.to, give: t.give, receive: t.receive }] };
      note(s, 'trade_counter', me, `${s.players[me].name} countered ${s.players[other].name}'s offer.`, { with: other });
      break;
    }
  }
  return s;
}

// ── Helpers (all mutate the draft state) ─────────────────────────────────────

/** Copy everything the reducer may mutate (much faster than structuredClone). Log entries are immutable. */
function cloneState(s: GameState): GameState {
  const b = s.battle;
  const d: GameState = {
    ...s,
    players: s.players.map((p) => ({ ...p, balls: { ...p.balls } })),
    tiles: s.tiles.map((t) => ({ ...t })),
    deck: s.deck.slice(),
    lastRoll: s.lastRoll && s.lastRoll.slice(),
    log: s.log.slice(),
    bankruptOrder: s.bankruptOrder.slice(),
    debt: s.debt && { ...s.debt, then: cloneContinuation(s.debt.then) },
    battle: b && {
      ...b,
      sides: [{ ...b.sides[0] }, { ...b.sides[1] }],
      text: b.text.slice(),
      lastHit: b.lastHit && { ...b.lastHit },
    },
  };
  sharedEvents.add(d);
  return d;
}

/** Answers the pending offer and returns to the phase it was made in. */
function respondTrade(s: GameState, accept: boolean): void {
  const t = s.pendingTrade!;
  s.pendingTrade = null;
  s.phase = t.returnPhase;
  const from = s.players[t.from];
  const to = s.players[t.to];
  const answerer = t.answerer ?? t.to;
  const ans = s.players[answerer];
  const proposals = (t.history?.length ?? 0) + 1;
  const what = proposals > 1 ? ' the counter' : '';
  let outcome: TradeResult['outcome'];
  if (!accept) {
    outcome = 'declined';
    log(s, `${ans.name} declined${what}.`);
    const otherName = s.players[answerer === t.from ? t.to : t.from].name;
    event(s, 'trade_declined', answerer, `${ans.name} declined ${otherName}'s ${proposals > 1 ? 'counter-offer' : 'trade offer'}.`, { with: answerer === t.from ? t.to : t.from });
  } else if (!tradeStillValid(s, t)) {
    outcome = 'cancelled';
    note(s, 'trade_declined', t.from, `The trade between ${from.name} and ${to.name} was cancelled: the offer no longer adds up.`, { with: t.to });
  } else {
    outcome = 'accepted';
    // Names as they arrive (level 1, first form).
    const side = (x: TradeSide) =>
      [...x.tiles.map((i) => formAtLevel(s, i, CONFIG.startLevel).name), ...(x.money > 0 ? [money(x.money)] : [])].join(' + ');
    log(s, `${ans.name} accepted${what}: ${from.name} gets ${side(t.receive)}, ${to.name} gets ${side(t.give)}.`);
    const drops = applyTrade(s, t);
    for (const d of drops) {
      log(s, `${s.players[d.owner].name}'s ${tileForm(s, d.tile).name} lost its pair and dropped to Lv ${d.toLevel}.`);
    }
    const dropText = drops.map((d) => ` ${s.players[d.owner].name}'s ${tileForm(s, d.tile).name} dropped to Lv ${d.toLevel}.`).join('');
    event(s, 'trade', t.from, `${from.name} and ${to.name} traded: ${from.name} got ${side(t.receive)}, ${to.name} got ${side(t.give)}.${dropText}`, { with: t.to });
  }
  const result: TradeResult = {
    from: t.from,
    to: t.to,
    give: t.give,
    receive: t.receive,
    seq: (s.lastTrade?.seq ?? 0) + 1,
    outcome,
    round: s.round,
    proposals,
    answeredBy: answerer,
  };
  s.lastTrade = result;
  // A negotiation that ends in a decline at any step counts as the opening offer being declined.
  const opening = t.history?.[0] ?? t;
  const declined: TradeResult = { ...result, to: opening.to, give: opening.give, receive: opening.receive };
  const keep = CONFIG.trade.declineMemoryRounds;
  s.tradeDeclines = [...s.tradeDeclines.filter((d) => s.round - d.round < keep), ...(outcome === 'declined' ? [declined] : [])];
}

function cloneContinuation(c: Continuation): Continuation {
  return c.k === 'birthday' ? { ...c, queue: c.queue.slice() } : { ...c };
}

function log(s: GameState, text: string): void {
  s.logSeq += 1;
  s.log.push({ id: s.logSeq, text, round: s.round });
  if (s.log.length > CONFIG.logSize) s.log.splice(0, s.log.length - CONFIG.logSize);
}

/** Drafts whose `events` array is still shared with the state they were cloned from (copied on first append). */
const sharedEvents = new WeakSet<GameState>();

/** Appends a structured event with everyone's cash and net worth right after it. */
function event(s: GameState, type: GameEventType, player: PlayerId | null, text: string, meta?: EventMeta): void {
  if (sharedEvents.has(s)) {
    s.events = s.events.slice();
    sharedEvents.delete(s);
  }
  s.events.push({
    id: (s.events[s.events.length - 1]?.id ?? 0) + 1,
    turn: s.turnSeq + 1,
    round: s.round,
    player,
    type,
    text,
    cash: s.players.map((pl) => pl.cash),
    worth: s.players.map((_, i) => netWorth(s, i)),
    ...(meta ? { meta } : {}),
  });
}

/** A log line that is also an event, with the same text. */
function note(s: GameState, type: GameEventType, player: PlayerId | null, text: string, meta?: EventMeta): void {
  log(s, text);
  event(s, type, player, text, meta);
}

function tileLabel(s: GameState, i: number): string {
  return isProperty(s, i) ? tileForm(s, i).name : s.board[i].name;
}

function movePlayer(s: GameState, pid: PlayerId, steps: number, goMoney: boolean): void {
  const p = s.players[pid];
  const raw = p.position + steps;
  if (steps > 0 && goMoney && raw >= BOARD_SIZE) {
    p.cash += CONFIG.goPayout;
    note(s, 'money_gain', pid, `${p.name} passed ${s.board[GO_TILE].name} and collected ${money(CONFIG.goPayout)}.`);
  }
  p.position = ((raw % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
}

function sendToHideout(s: GameState, pid: PlayerId): void {
  const p = s.players[pid];
  p.position = HIDEOUT_TILE;
  p.inHideout = true;
  p.hideoutFails = 0;
  note(s, 'move', pid, `${p.name} was taken to the ${WORDS.hideout}!`, { tile: HIDEOUT_TILE });
}

function resolveTile(s: GameState): void {
  const p = s.players[s.current];
  const i = p.position;
  const def = s.board[i];
  switch (def.kind) {
    case 'pokemon':
    case 'legendary': {
      const owner = s.tiles[i].owner;
      if (owner === null) {
        log(s, `${p.name} landed on ${def.name} (wild, ${money(tilePrice(s, i))}).`);
        s.pendingTile = i;
        s.phase = 'buy';
      } else if (owner === s.current) {
        log(s, `${p.name} landed on their own ${tileLabel(s, i)}.`);
        s.phase = 'endTurn';
      } else {
        log(s, `${p.name} landed on ${tileLabel(s, i)} (${s.players[owner].name}). Fee: ${money(tileFee(s, i))}.`);
        s.pendingTile = i;
        s.phase = 'feeChoice';
      }
      return;
    }
    case 'card': {
      if (s.deckPos >= s.deck.length) {
        s.deck = shuffle(s, CONFIG.cards.map((_, n) => n));
        s.deckPos = 0;
      }
      s.pendingCard = s.deck[s.deckPos];
      s.deckPos += 1;
      note(s, 'card', s.current, `${p.name} drew a card: "${CARD_TEXT[s.pendingCard]}"`);
      s.phase = 'card';
      return;
    }
    case 'bonus':
      p.cash += CONFIG.bonusTilePayout;
      note(s, 'money_gain', s.current, `${p.name} visited the ${def.name} and collected ${money(CONFIG.bonusTilePayout)}.`);
      s.phase = 'endTurn';
      return;
    case 'ambush':
      log(s, `${p.name} was ambushed by a ${WORDS.grunt}!`);
      s.phase = 'ambushChoice';
      return;
    case 'goToHideout':
      sendToHideout(s, s.current);
      s.phase = 'endTurn';
      return;
    default:
      s.phase = 'endTurn';
  }
}

function startBattle(s: GameState, fighter: FighterRef): void {
  const pid = s.current;
  const p = s.players[pid];
  const f = fighterInfo(s, pid, fighter);
  const attacker = makeCombatant(pid, f.tile, f.name, f.dex, f.type, f.level);
  let kind: BattleKind;
  let defender;
  let stake: number;
  let creditor: PlayerId | null = null;
  let tile: number | null = null;

  if (s.phase === 'feeChoice') {
    kind = 'fee';
    tile = s.pendingTile!;
    const owner = s.tiles[tile].owner!;
    const form = tileForm(s, tile);
    defender = makeCombatant(owner, tile, form.name, form.dex, tileType(s, tile), battleLevelOfTile(s, tile));
    stake = challengeCosts(s)!.loseBattle;
    creditor = owner;
    s.pendingTile = null;
  } else {
    kind = s.phase === 'hideout' ? 'hideout' : 'ambush';
    const g = GRUNTS[nextInt(s, 0, GRUNTS.length - 1)];
    defender = makeCombatant(null, null, g.name, g.dex, NEUTRAL_TYPE, gruntLevel(s.round));
    stake = kind === 'hideout' ? 0 : challengeCosts(s)!.loseBattle;
  }

  const b: Battle = {
    kind,
    tile,
    stake,
    creditor,
    attacker: pid,
    sides: [defender, attacker],
    turn: 0,
    moves: 0,
    text: [`${p.name} sent out ${attacker.name} (Lv ${attacker.level}) against ${defender.name} (Lv ${defender.level})!`],
    winner: null,
    endReason: null,
    lastHit: null,
  };
  s.battle = b;
  s.phase = 'battle';
}

function settleBattle(s: GameState): void {
  const b = s.battle!;
  s.battle = null;
  const pid = b.attacker;
  const p = s.players[pid];
  const won = b.winner === 1;
  const att = b.sides[1];
  const def = b.sides[0];
  const ownerName = def.owner !== null ? `'s ${def.name}` : '';
  const vs = def.owner !== null ? `${s.players[def.owner].name}${ownerName}` : def.name;
  const meta: EventMeta = { battle: b.kind, opponent: def.owner, level: att.level, ...(b.tile !== null ? { tile: b.tile } : {}) };
  const result = (text: string) => note(s, won ? 'battle_won' : 'battle_lost', pid, text, meta);

  if (b.kind === 'fee') {
    if (won) {
      result(`Battle: ${p.name}'s ${att.name} beat ${vs}. No fee.`);
      s.phase = 'endTurn';
    } else {
      result(`Battle: ${p.name}'s ${att.name} lost to ${vs}.`);
      charge(s, pid, b.creditor, b.stake, { k: 'endTurn' }, 'battle');
    }
  } else if (b.kind === 'ambush') {
    if (won) {
      result(`${p.name}'s ${att.name} fought off the ${WORDS.grunt}.`);
      s.phase = 'endTurn';
    } else {
      result(`${p.name}'s ${att.name} lost to the ${WORDS.grunt}.`);
      charge(s, pid, null, b.stake, { k: 'endTurn' }, 'ambush');
    }
  } else {
    if (won) {
      p.inHideout = false;
      p.hideoutFails = 0;
      result(`${p.name} beat the ${WORDS.guard} and escaped!`);
      s.phase = 'roll';
    } else {
      p.hideoutFails += 1;
      if (p.hideoutFails >= CONFIG.hideout.maxFailedTurns) {
        p.inHideout = false;
        p.hideoutFails = 0;
        result(`${p.name} lost to the ${WORDS.guard} again and paid to get out.`);
        charge(s, pid, null, CONFIG.hideout.fee, { k: 'roll' }, 'hideout');
      } else {
        result(`${p.name} lost to the ${WORDS.guard}. Stuck in the ${WORDS.hideoutShort} (${p.hideoutFails}/${CONFIG.hideout.maxFailedTurns}).`);
        s.phase = 'endTurn';
      }
    }
  }
}

/** Debtor pays creditor (null = bank). Opens liquidation or bankrupts if short. */
function charge(s: GameState, debtor: PlayerId, creditor: PlayerId | null, amount: number, then: Continuation, reason: PayReason): void {
  const p = s.players[debtor];
  const to = creditor === null ? 'the bank' : s.players[creditor].name;
  if (p.cash >= amount) {
    p.cash -= amount;
    if (creditor !== null) s.players[creditor].cash += amount;
    note(s, 'payment', debtor, `${p.name} paid ${money(amount)} to ${to}.`, { to: creditor, reason });
    continueWith(s, then);
    return;
  }
  if (ownedTiles(s, debtor).length > 0) {
    log(s, `${p.name} owes ${money(amount)} but only has ${money(p.cash)}. Must release ${WORDS.creatures}.`);
    s.debt = { debtor, creditor, amount, then, reason };
    s.phase = 'debt';
    return;
  }
  // Bankrupt.
  const paid = p.cash;
  p.cash = 0;
  if (creditor !== null) s.players[creditor].cash += paid;
  p.bankrupt = true;
  p.balls = { poke: 0, great: 0, ultra: 0 }; // a bankrupt player's balls are discarded
  p.inHideout = false;
  s.bankruptOrder.push(debtor);
  note(s, 'bankruptcy', debtor, `${p.name} couldn't pay ${money(amount)}, gave ${to} their last ${money(paid)}, and is bankrupt!`, { to: creditor, reason });
  if (checkLastStanding(s)) return;
  if (debtor === s.current) advanceTurn(s);
  else continueWith(s, then);
}

function continueWith(s: GameState, then: Continuation): void {
  switch (then.k) {
    case 'endTurn':
      s.phase = 'endTurn';
      return;
    case 'roll':
      s.phase = 'roll';
      return;
    case 'birthday': {
      const queue = then.queue.filter((id) => !s.players[id].bankrupt);
      if (queue.length === 0) {
        s.phase = 'endTurn';
        return;
      }
      const [next, ...rest] = queue;
      charge(s, next, then.to, then.amount, { ...then, queue: rest }, 'birthday');
      return;
    }
  }
}

function checkLastStanding(s: GameState): boolean {
  const alive = alivePlayers(s);
  if (alive.length > 1) return false;
  s.winner = alive[0] ?? null;
  s.phase = 'gameOver';
  s.battle = null;
  s.debt = null;
  if (s.winner !== null) note(s, 'game_over', s.winner, `${s.players[s.winner].name} is the last player standing and wins!`);
  return true;
}

function endByRoundLimit(s: GameState): void {
  const alive = alivePlayers(s);
  let best = alive[0];
  for (const id of alive) if (netWorth(s, id) > netWorth(s, best)) best = id;
  s.winner = best;
  s.phase = 'gameOver';
  s.round = s.roundLimit;
  note(s, 'game_over', best, `Round limit reached. ${s.players[best].name} wins with a net worth of ${money(netWorth(s, best))}!`);
}

function advanceTurn(s: GameState): void {
  const n = s.players.length;
  let wrapped = false;
  let next = s.current;
  for (let k = 1; k <= n; k++) {
    if (s.current + k >= n) wrapped = true;
    const idx = (s.current + k) % n;
    if (!s.players[idx].bankrupt) {
      next = idx;
      break;
    }
  }
  if (wrapped) {
    s.round += 1;
    if (s.round > s.roundLimit) {
      endByRoundLimit(s);
      return;
    }
    log(s, `── Round ${s.round} of ${s.roundLimit} ──`);
  }
  s.current = next;
  s.turnSeq += 1;
  s.shopClosed = false;
  s.shopBuys = 0;
  s.tradeOffers = 0;
  s.pendingTile = null;
  s.pendingCard = null;
  const p = s.players[next];
  s.phase = p.inHideout ? 'hideout' : 'roll';
}

function levelUp(s: GameState, pid: PlayerId, ref: FighterRef, free: boolean): void {
  const p = s.players[pid];
  const check = levelUpCheck(s, pid, ref, free);
  if (!check.ok) return;
  if (!free) p.cash -= check.cost;
  const how = free ? 'for free' : `for ${money(check.cost)}`;
  if (ref.kind === 'starter') {
    p.starterLevel += 1;
    note(s, 'level_up', pid, `${p.name} trained ${STARTERS[p.starter].name} to Lv ${p.starterLevel} ${how}.`, { level: p.starterLevel });
    return;
  }
  const t = s.tiles[ref.tile];
  const before = formAtLevel(s, ref.tile, t.level);
  t.level += 1;
  log(s, `${p.name} leveled ${before.name} to Lv ${t.level} ${how}.`);
  const evolved = stageForLevel(t.level) !== stageForLevel(t.level - 1);
  if (evolved) log(s, `${before.name} evolved into ${formAtLevel(s, ref.tile, t.level).name}!`);
  const evo = evolved ? ` It evolved into ${formAtLevel(s, ref.tile, t.level).name}!` : '';
  event(s, 'level_up', pid, `${p.name} leveled ${before.name} to Lv ${t.level} ${how}.${evo}`, { tile: ref.tile, level: t.level });
}

/** One throw per landing: resolves the catch and always ends the landing. */
function throwBall(s: GameState, ball: ThrowBall): void {
  const pid = s.current;
  const p = s.players[pid];
  const i = s.pendingTile!;
  const name = s.board[i].name;
  const chance = catchChance(s, i, ball);
  let caught: boolean;
  let shakes: number;
  if (ball === 'master') {
    p.cash -= masterBallCost(s, i);
    caught = true;
    shakes = 3;
  } else {
    p.balls[ball] -= 1;
    const roll = nextFloat(s);
    caught = roll < chance;
    // On a miss, the closer the roll was to the chance, the more shakes before it breaks free.
    const closeness = caught ? 1 : 1 - (roll - chance) / (1 - chance);
    shakes = caught ? 3 : Math.min(2, Math.floor(closeness * 3));
  }
  const cost = ball === 'master' ? ` for ${money(masterBallCost(s, i))}` : '';
  log(s, `${p.name} threw a ${BALLS[ball].name}${cost} at ${name}… ${caught ? 'caught!' : 'it broke free!'}`);
  if (caught) s.tiles[i] = { owner: pid, level: CONFIG.startLevel };
  const odds = ball === 'master' ? '' : ` (${Math.floor(chance * 100 + 1e-9)}% chance)`;
  event(
    s,
    caught ? 'catch_success' : 'catch_fail',
    pid,
    caught
      ? `${p.name} caught ${name} with a ${BALLS[ball].name}${cost}${odds}.`
      : `${name} broke free from ${p.name}'s ${BALLS[ball].name}${odds}.`,
    { ball, chance, tile: i },
  );
  s.lastThrow = { seq: (s.lastThrow?.seq ?? 0) + 1, player: pid, tile: i, ball, caught, shakes };
  s.pendingTile = null;
  s.phase = 'endTurn';
}

function applyCard(s: GameState): void {
  const pid = s.current;
  const p = s.players[pid];
  const effect = CONFIG.cards[s.pendingCard!];
  s.pendingCard = null;
  switch (effect.kind) {
    case 'gain':
      p.cash += effect.amount;
      note(s, 'money_gain', pid, `${p.name} collected ${money(effect.amount)}.`);
      s.phase = 'endTurn';
      return;
    case 'lose':
      charge(s, pid, null, effect.amount, { k: 'endTurn' }, 'card');
      return;
    case 'rareCandy': {
      // Auto-pick: highest-fee creature that can still level, then the starter.
      const tiles = ownedTiles(s, pid)
        .filter((tile) => levelUpCheck(s, pid, { kind: 'tile', tile }, true).ok)
        .sort((a, b) => tileFee(s, b) - tileFee(s, a) || a - b);
      let target: FighterRef | null = null;
      if (tiles.length > 0) target = { kind: 'tile', tile: tiles[0] };
      else if (levelUpCheck(s, pid, { kind: 'starter' }, true).ok) target = { kind: 'starter' };
      if (target) levelUp(s, pid, target, true);
      else {
        p.cash += effect.fallback;
        note(s, 'money_gain', pid, `Nothing could level up, so ${p.name} sold it for ${money(effect.fallback)}.`);
      }
      s.phase = 'endTurn';
      return;
    }
    case 'advanceToGo':
      movePlayer(s, pid, BOARD_SIZE - p.position, true);
      event(s, 'move', pid, `${p.name} flew to ${s.board[GO_TILE].name}.`, { tile: GO_TILE });
      resolveTile(s);
      return;
    case 'move':
      movePlayer(s, pid, effect.steps, effect.steps > 0);
      note(s, 'move', pid, `${p.name} moved to ${tileLabel(s, p.position)}.`, { tile: p.position });
      resolveTile(s);
      return;
    case 'goToHideout':
      sendToHideout(s, pid);
      s.phase = 'endTurn';
      return;
    case 'escapeRope':
      p.escapeRopes += 1;
      log(s, `${p.name} kept an ${WORDS.escapeRope}.`);
      s.phase = 'endTurn';
      return;
    case 'gainBall': {
      const name = BALLS[effect.ball].name;
      if (ballsCarried(s, pid) < CONFIG.balls.carryLimit) {
        p.balls[effect.ball] += 1;
        log(s, `${p.name} got a ${name}.`);
      } else {
        p.cash += effect.fallback;
        note(s, 'money_gain', pid, `${p.name}'s bag is full, so they sold the ${name} for ${money(effect.fallback)}.`);
      }
      s.phase = 'endTurn';
      return;
    }
    case 'birthday': {
      const others = alivePlayers(s).filter((id) => id !== pid);
      continueWith(s, { k: 'birthday', to: pid, queue: others, amount: effect.amount });
      return;
    }
  }
}

