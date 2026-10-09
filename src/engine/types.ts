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

export interface PendingTrade extends TradeOffer {
  from: PlayerId;
  /** The phase the turn goes back to once the offer is answered. */
  returnPhase: Phase;
}

/** The latest answered offer, for the UI's result banner (and the bots' no-repeat rule). */
export interface TradeResult extends TradeOffer {
  seq: number;
  from: PlayerId;
  outcome: 'accepted' | 'declined' | 'cancelled';
  round: number;
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
