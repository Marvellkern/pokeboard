import type { BallKind, SlotId, ThrowBall, TileDef, TypeId } from '../data/theme';

export type PlayerId = number;

export type BoardMode = 'shuffled' | 'classic';

/** One tile of the game's board, as generated at game creation and stored in GameState. */
export interface BoardTile extends TileDef {
  /** Pair slot for regular creature tiles (both tiles of a slot share type and price). */
  slot?: SlotId;
}

export type CardEffect =
  | { kind: 'gain'; amount: number }
  | { kind: 'lose'; amount: number }
  | { kind: 'rareCandy'; fallback: number }
  | { kind: 'advanceToGo' }
  | { kind: 'move'; steps: number }
  | { kind: 'goToHideout' }
  | { kind: 'escapeRope' }
  | { kind: 'birthday'; amount: number }
  | { kind: 'gainBall'; ball: BallKind; fallback: number };

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  isBot: boolean;
  /** Index into theme.STARTERS. */
  starter: number;
  starterLevel: number;
  cash: number;
  position: number;
  inHideout: boolean;
  hideoutFails: number;
  escapeRopes: number;
  bankrupt: boolean;
  /** Carried balls (the Master Ball is never carried). */
  balls: Record<BallKind, number>;
}

export interface TileState {
  owner: PlayerId | null;
  level: number;
}

/** A creature a player can send into battle. */
export type FighterRef = { kind: 'starter' } | { kind: 'tile'; tile: number };

export type MoveKind = 'tackle' | 'type' | 'protect';

export interface Combatant {
  /** null = grunt (bank-controlled bot). */
  owner: PlayerId | null;
  /** Board tile this creature defends, if any. */
  tile: number | null;
  name: string;
  dex: number;
  type: TypeId;
  level: number;
  hp: number;
  maxHp: number;
  /** Halves the next hit taken; cleared at own next action. */
  protecting: boolean;
  /** Last action was Protect (next attack boosted; can't Protect again). */
  usedProtect: boolean;
}

export type BattleKind = 'fee' | 'ambush' | 'hideout';
/** 0 = defender, 1 = attacker. */
export type Side = 0 | 1;

export interface BattleHit {
  side: Side; // side that took the hit
  damage: number;
  seq: number;
}

export interface Battle {
  kind: BattleKind;
  /** Fee tile (for 'fee' battles). */
  tile: number | null;
  /** Amount the attacker pays on a loss. */
  stake: number;
  /** Who receives the stake (null = bank). */
  creditor: PlayerId | null;
  attacker: PlayerId;
  sides: [Combatant, Combatant];
  turn: Side;
  moves: number;
  /** Last two lines of battle text. */
  text: string[];
  winner: Side | null;
  endReason: 'ko' | 'cap' | null;
  lastHit: BattleHit | null;
}

export type Continuation =
  | { k: 'endTurn' }
  | { k: 'roll' }
  | { k: 'birthday'; to: PlayerId; queue: PlayerId[]; amount: number };

export interface Debt {
  debtor: PlayerId;
  creditor: PlayerId | null;
  amount: number;
  then: Continuation;
  /** Why it's owed (older saves: missing). */
  reason?: EventMeta['reason'];
}

export type Phase =
  | 'roll'
  | 'hideout'
  | 'buy'
  | 'feeChoice'
  | 'ambushChoice'
  | 'card'
  | 'battle'
  | 'battleOver'
  | 'debt'
  /** A trade offer is waiting for the recipient's answer (returns to `pendingTrade.returnPhase`). */
  | 'trade'
  | 'endTurn'
  | 'gameOver';

/** One side of a trade: creature tiles plus money. */
export interface TradeSide {
  tiles: number[];
  money: number;
}

/** A trade offer from the current player: what they give and what they get. */
export interface TradeOffer {
  to: PlayerId;
  give: TradeSide;
  receive: TradeSide;
}

/**
 * The open negotiation. `give` / `receive` are always the newest proposal, seen from the turn player
 * (`from`, who made the first offer); `to` is the other player. Counters alternate who answers.
 */
export interface PendingTrade extends TradeOffer {
  from: PlayerId;
  /** The phase the turn goes back to once the offer is answered. */
  returnPhase: Phase;
  /** Who must answer now (accept, decline, or counter while the limit allows). */
  answerer: PlayerId;
  /** Earlier proposals, oldest first (also from `from`'s side). The newest one is give/receive. */
  history: TradeOffer[];
}

/** The latest answered offer, for the UI's result banner (and the bots' no-repeat rule). */
export interface TradeResult extends TradeOffer {
  seq: number;
  from: PlayerId;
  outcome: 'accepted' | 'declined' | 'cancelled';
  round: number;
  /** How many proposals the negotiation had (1 = no counter). Older saves: missing. */
  proposals?: number;
  /** Who gave the final answer. Older saves: missing (it was `to`). */
  answeredBy?: PlayerId;
}

export type GameEventType =
  | 'start'
  | 'roll'
  | 'move'
  | 'card'
  | 'ball_purchase'
  | 'catch_success'
  | 'catch_fail'
  | 'battle_won'
  | 'battle_lost'
  /** Money from one player to another or to the bank (fees, lost battles, cards, birthdays). */
  | 'payment'
  /** Money from the bank: GO, bonus tile, cards. */
  | 'money_gain'
  | 'level_up'
  /** A creature released to pay a debt. */
  | 'release'
  | 'trade'
  | 'trade_counter'
  | 'trade_declined'
  | 'bankruptcy'
  | 'game_over';

/**
 * One structured, append-only game event (the recap reads these). `cash` and `worth` are every
 * player's cash and net worth right after the event; money moved by an event is the difference
 * from the previous event's snapshot.
 */
export interface GameEvent {
  id: number;
  /** Turn number (1-based, counts every turn of every player). */
  turn: number;
  round: number;
  /** Who it's about (null = nobody in particular). */
  player: PlayerId | null;
  type: GameEventType;
  /** Ready-to-show sentence. */
  text: string;
  cash: number[];
  worth: number[];
  meta?: EventMeta;
}

export interface EventMeta {
  tile?: number;
  ball?: ThrowBall;
  /** Catch chance of the throw (0-1). */
  chance?: number;
  dice?: number[];
  /** Battles: kind, and the other side's owner (null = a grunt). */
  battle?: BattleKind;
  opponent?: PlayerId | null;
  /** Payments: who received it (null = the bank) and why. */
  to?: PlayerId | null;
  reason?: 'fee' | 'battle' | 'ambush' | 'hideout' | 'card' | 'birthday';
  /** Trades: the other player. */
  with?: PlayerId;
  level?: number;
}

export interface LogEntry {
  id: number;
  text: string;
  round: number;
}

export interface GameState {
  version: 1;
  seed: number;
  /** Seeded RNG state (uint32). All randomness flows through this. */
  rng: number;
  /** This game's board (generated once at creation; saved with the game). */
  board: BoardTile[];
  boardMode: BoardMode;
  players: Player[];
  tiles: TileState[];
  current: PlayerId;
  round: number;
  roundLimit: number;
  phase: Phase;
  /** Tile being decided on (buy / fee). */
  pendingTile: number | null;
  /** Card drawn, waiting for ACK. */
  pendingCard: number | null;
  deck: number[];
  deckPos: number;
  lastRoll: number[] | null;
  /** Increments on every roll (UI uses it to trigger the dice animation). */
  rollSeq: number;
  /** Increments every time the turn passes. */
  turnSeq: number;
  battle: Battle | null;
  debt: Debt | null;
  log: LogEntry[];
  logSeq: number;
  /** True once the current player has rolled or made the hideout choice this turn. */
  shopClosed: boolean;
  /** Balls bought this turn (bots buy at most one). */
  shopBuys: number;
  /** The latest throw, for the UI to animate (outcome already applied). */
  lastThrow: ThrowResult | null;
  /** The offer waiting for an answer (phase 'trade'). */
  pendingTrade: PendingTrade | null;
  /** Offers the current player has made this turn (limit: CONFIG.trade.offersPerTurn). */
  tradeOffers: number;
  /** The latest answered offer. */
  lastTrade: TradeResult | null;
  /** Recently declined offers (kept a few rounds; bots don't repeat them). */
  tradeDeclines: TradeResult[];
  /** Every meaningful event of the game, in order (for the game log and the recap). */
  events: GameEvent[];
  /** Set when the game ends. */
  winner: PlayerId | null;
  /** Order in which players went bankrupt (for final ranking). */
  bankruptOrder: PlayerId[];
}

export interface ThrowResult {
  seq: number;
  player: PlayerId;
  tile: number;
  ball: ThrowBall;
  caught: boolean;
  /** 3 = caught; 0-2 on a miss (closer miss = more shakes). */
  shakes: number;
}

/**
 * An action, optionally stamped with the seat taking it (`by`). When `by` is present the engine
 * rejects it unless that seat is the one the game is waiting on (null = a grunt). Online play
 * always stamps it; local play does too.
 */
export type Action = ActionBody & { by?: PlayerId | null };

export type ActionBody =
  | { type: 'ROLL' }
  | { type: 'BUY_BALL'; ball: BallKind }
  | { type: 'THROW'; ball: ThrowBall }
  | { type: 'SKIP' }
  | { type: 'PAY' }
  | { type: 'BATTLE'; fighter: FighterRef }
  | { type: 'USE_ROPE' }
  | { type: 'MOVE'; move: MoveKind }
  | { type: 'ACK' }
  | { type: 'LEVEL_UP'; target: FighterRef }
  | { type: 'RELEASE'; tile: number }
  | ({ type: 'PROPOSE_TRADE' } & TradeOffer)
  | { type: 'RESPOND_TRADE'; accept: boolean }
  /** The answerer replaces the newest proposal; give/receive are from the countering player's side. */
  | { type: 'COUNTER_TRADE'; give: TradeSide; receive: TradeSide }
  | { type: 'END_TURN' };

export interface SetupPlayer {
  name: string;
  color: string;
  isBot: boolean;
  starter: number;
}

export interface GameSetup {
  players: SetupPlayer[];
  roundLimit: number;
  /** Defaults to 'classic' in the engine; the setup screen defaults to 'shuffled'. */
  boardMode?: BoardMode;
}
