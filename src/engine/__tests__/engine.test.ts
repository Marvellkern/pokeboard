import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../data/config';
import { NEUTRAL_TYPE, TYPE_CHART, type TypeId } from '../../data/theme';
import { applyMove, damageRange, makeCombatant, maxHpFor, typeMultiplier } from '../battle';
import { chooseAction } from '../bot';
import { createGame, reduce } from '../reducer';
import {
  BOARD_SIZE,
  challengeCosts,
  GO_TILE,
  HIDEOUT_TILE,
  feeAt,
  formAtLevel,
  isLegal,
  legalActions,
  levelCost,
  levelUpCheck,
  netWorth,
  pairPartner,
  releaseValue,
  tileFee,
  tilePrice,
} from '../selectors';
import type { Action, Battle, GameState } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A classic-board game; tests read tile data from its board (the old static list is gone). */
const BASE = game();
const TILES = BASE.board;

const idx = (pred: (t: (typeof TILES)[number], i: number) => boolean) => TILES.findIndex(pred);
const firstMon = idx((t) => t.kind === 'pokemon');
const partnerOfFirst = pairPartner(BASE, firstMon)!;
const legendaries = TILES.map((t, i) => (t.kind === 'legendary' ? i : -1)).filter((i) => i >= 0);
const cardTile = idx((t) => t.kind === 'card');
const ambushTile = idx((t) => t.kind === 'ambush');
const bonusTile = idx((t) => t.kind === 'bonus');
const goToHideoutTile = idx((t) => t.kind === 'goToHideout');
const cardIndex = (kind: string, pred: (e: (typeof CONFIG.cards)[number]) => boolean = () => true) =>
  CONFIG.cards.findIndex((c) => c.kind === kind && pred(c));

function game(n = 2, seed = 42, roundLimit = 20): GameState {
  return createGame(
    {
      players: Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, color: '#000', isBot: false, starter: i })),
      roundLimit,
    },
    seed,
  );
}

/** Apply an action, failing the test if it's illegal. */
function act(s: GameState, a: Action): GameState {
  expect(isLegal(s, a), `illegal ${JSON.stringify(a)} in phase ${s.phase}`).toBe(true);
  return reduce(s, a);
}

function edit(s: GameState, fn: (d: GameState) => void): GameState {
  const d = structuredClone(s);
  fn(d);
  return d;
}

/** Place current player so that resolving lands on tile `i` (via a card "move" trick is messy), so we set phase directly. */
function landOn(s: GameState, i: number): GameState {
  // Dice are random, so we land deterministically by drawing a "move N" card from N tiles away.
  // Uses the forward card unless that would pass GO, in which case the backward card.
  const fwd = cardIndex('move', (c) => c.kind === 'move' && c.steps > 0);
  const back = cardIndex('move', (c) => c.kind === 'move' && c.steps < 0);
  const fwdSteps = (CONFIG.cards[fwd] as { steps: number }).steps;
  const mv = i >= fwdSteps ? fwd : back;
  const steps = (CONFIG.cards[mv] as { steps: number }).steps;
  return act(
    edit(s, (d) => {
      d.players[d.current].position = (i - steps + BOARD_SIZE) % BOARD_SIZE;
      d.phase = 'card';
      d.pendingCard = mv;
    }),
    { type: 'ACK' },
  );
}

function drawCard(s: GameState, card: number): GameState {
  return act(
    edit(s, (d) => {
      d.phase = 'card';
      d.pendingCard = card;
    }),
    { type: 'ACK' },
  );
}

function own(s: GameState, pid: number, tile: number, level = 1): GameState {
  return edit(s, (d) => {
    d.tiles[tile] = { owner: pid, level };
  });
}

/** Play out a battle with fixed moves for both sides. */
function fight(s: GameState, def: Action, att: Action): GameState {
  let st = s;
  let guard = 0;
  while (st.phase === 'battle' && guard++ < 50) {
    const a = st.battle!.turn === 0 ? def : att;
    const legal = isLegal(st, a) ? a : ({ type: 'MOVE', move: 'tackle' } as Action);
    st = act(st, legal);
  }
  return st;
}

const TACKLE: Action = { type: 'MOVE', move: 'tackle' };
const TYPE: Action = { type: 'MOVE', move: 'type' };

// ── Setup ────────────────────────────────────────────────────────────────────

describe('setup', () => {
  it('starts everyone on GO with starting money', () => {
    const s = game(4);
    expect(s.players.every((p) => p.cash === CONFIG.startingMoney && p.position === GO_TILE)).toBe(true);
    expect(s.phase).toBe('roll');
    expect(s.round).toBe(1);
    expect(s.deck.slice().sort((a, b) => a - b)).toEqual(CONFIG.cards.map((_, i) => i));
  });

  it('board has 28 tiles with 4 corners 7 apart', () => {
    expect(BOARD_SIZE).toBe(28);
    expect(HIDEOUT_TILE).toBe(7);
  });
});

// ── Movement ─────────────────────────────────────────────────────────────────

describe('rolling and moving', () => {
  it('rolls 2 dice and moves by their sum', () => {
    const s = act(game(), { type: 'ROLL' });
    const total = s.lastRoll!.reduce((a, b) => a + b, 0);
    expect(s.lastRoll!.length).toBe(CONFIG.dice.count);
    expect(s.players[0].position).toBe(total % BOARD_SIZE);
  });

  it('pays GO money when passing GO', () => {
    let s = edit(game(), (d) => (d.players[0].position = BOARD_SIZE - 1));
    s = act(s, { type: 'ROLL' });
    expect(s.players[0].cash).toBeGreaterThanOrEqual(CONFIG.startingMoney + CONFIG.goPayout - 200);
    expect(s.log.some((l) => l.text.includes('collected'))).toBe(true);
  });

  it('bonus tile pays out', () => {
    const s = landOn(game(), bonusTile);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney + CONFIG.bonusTilePayout);
    expect(s.phase).toBe('endTurn');
  });

  it('go-to-hideout tile sends you to the hideout without GO money', () => {
    const s = landOn(game(), goToHideoutTile);
    expect(s.players[0].position).toBe(HIDEOUT_TILE);
    expect(s.players[0].inHideout).toBe(true);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney);
  });
});

// ── Catching (the Master Ball replaces the old direct buy) ───────────────────

describe('catching with the Master Ball', () => {
  it('the Master Ball costs the tile price and always catches', () => {
    let s = landOn(game(), firstMon);
    expect(s.phase).toBe('buy');
    s = act(s, { type: 'THROW', ball: 'master' });
    expect(s.tiles[firstMon]).toEqual({ owner: 0, level: 1 });
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - tilePrice(BASE, firstMon));
  });

  it('no Master Ball without enough cash', () => {
    let s = edit(game(), (d) => (d.players[0].cash = 10));
    s = landOn(s, firstMon);
    expect(legalActions(s).some((a) => a.type === 'THROW' && a.ball === 'master')).toBe(false);
    expect(isLegal(s, { type: 'SKIP' })).toBe(true);
  });

  it('skipping leaves the tile unowned', () => {
    let s = landOn(game(), firstMon);
    s = act(s, { type: 'SKIP' });
    expect(s.tiles[firstMon].owner).toBeNull();
  });

  it('illegal actions return the same state', () => {
    const s = game();
    expect(reduce(s, { type: 'THROW', ball: 'master' })).toBe(s);
  });
});

// ── Fees, levels, evolution ──────────────────────────────────────────────────

describe('fees and levels', () => {
  it('fee = round(price × feeByLevel[level]), increasing and convex', () => {
    const water = idx((t) => t.kind === 'pokemon' && t.type === 'water');
    expect(tilePrice(BASE, water)).toBe(180);
    for (let lv = 1; lv <= CONFIG.maxLevel; lv++) {
      expect(feeAt(BASE, water, lv)).toBe(Math.round(180 * CONFIG.feeByLevel[lv]));
    }
    expect(feeAt(BASE, water, 1)).toBe(36); // level 1 unchanged from the original formula
    const m = Array.from({ length: CONFIG.maxLevel }, (_, k) => CONFIG.feeByLevel[k + 1]);
    for (let k = 1; k < m.length; k++) expect(m[k]).toBeGreaterThan(m[k - 1]);
    for (let k = 2; k < m.length; k++) expect(m[k] - m[k - 1]).toBeGreaterThanOrEqual(m[k - 1] - m[k - 2] - 1e-9);
  });

  it('level-up cost is half the price', () => {
    const water = idx((t) => t.kind === 'pokemon' && t.type === 'water');
    expect(levelCost(BASE, water)).toBe(90);
  });

  it('set rule: cannot go above level 2 without the pair', () => {
    let s = own(game(), 0, firstMon, 2);
    expect(levelUpCheck(s, 0, { kind: 'tile', tile: firstMon }).reason).toBe('needPair');
    s = own(s, 0, partnerOfFirst, 1);
    expect(levelUpCheck(s, 0, { kind: 'tile', tile: firstMon }).ok).toBe(true);
  });

  it('caps at max level', () => {
    let s = own(game(), 0, firstMon, CONFIG.maxLevel);
    s = own(s, 0, partnerOfFirst);
    expect(levelUpCheck(s, 0, { kind: 'tile', tile: firstMon }).reason).toBe('maxLevel');
  });

  it('level 1 → 2 allowed without the pair, costs money, and is legal only in manage phases', () => {
    let s = own(game(), 0, firstMon, 1);
    const a: Action = { type: 'LEVEL_UP', target: { kind: 'tile', tile: firstMon } };
    s = act(s, a);
    expect(s.tiles[firstMon].level).toBe(2);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - levelCost(BASE, firstMon));
    const inCard = edit(s, (d) => {
      d.phase = 'card';
      d.pendingCard = 0;
    });
    expect(isLegal(inCard, a)).toBe(false);
  });

  it('cannot level without cash', () => {
    const s = edit(own(game(), 0, firstMon), (d) => (d.players[0].cash = 0));
    expect(levelUpCheck(s, 0, { kind: 'tile', tile: firstMon }).reason).toBe('cash');
  });

  it('evolves at levels 3 and 5', () => {
    const forms = TILES[firstMon].forms!;
    expect(formAtLevel(BASE, firstMon, 1)).toEqual(forms[0]);
    expect(formAtLevel(BASE, firstMon, 2)).toEqual(forms[0]);
    expect(formAtLevel(BASE, firstMon, 3)).toEqual(forms[1]);
    expect(formAtLevel(BASE, firstMon, 4)).toEqual(forms[1]);
    expect(formAtLevel(BASE, firstMon, 5)).toEqual(forms[2]);
  });

  it('starters level to their cap for a flat cost and need no pair', () => {
    let s = game();
    const a: Action = { type: 'LEVEL_UP', target: { kind: 'starter' } };
    const ups = CONFIG.starter.maxLevel - CONFIG.startLevel;
    for (let k = 0; k < ups; k++) s = act(s, a);
    expect(s.players[0].starterLevel).toBe(CONFIG.starter.maxLevel);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - ups * CONFIG.starter.levelCost);
    expect(isLegal(s, a)).toBe(false);
  });

  it('a save with a starter above the cap keeps it, but cannot level it further', () => {
    let s = edit(game(), (d) => (d.players[0].starterLevel = CONFIG.starter.maxLevel + 1));
    expect(isLegal(s, { type: 'LEVEL_UP', target: { kind: 'starter' } })).toBe(false);
    s = landOn(s, ambushTile);
    s = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
    expect(s.battle!.sides[1].level).toBe(CONFIG.starter.maxLevel + 1);
  });

  it('legendaries cannot level and their fee scales with count', () => {
    let s = own(game(), 1, legendaries[0]);
    expect(levelUpCheck(s, 1, { kind: 'tile', tile: legendaries[0] }).reason).toBe('legendary');
    const fees = CONFIG.legendary.feeByCount;
    expect(tileFee(s, legendaries[0])).toBe(fees[1]);
    s = own(s, 1, legendaries[1]);
    expect(tileFee(s, legendaries[0])).toBe(fees[2]);
    s = own(s, 1, legendaries[2]);
    expect(tileFee(s, legendaries[0])).toBe(fees[3]);
    s = own(s, 1, legendaries[3]);
    expect(tileFee(s, legendaries[0])).toBe(fees[4]);
    expect([fees[1], fees[2], fees[3], fees[4]]).toEqual([50, 100, 200, 400]);
  });
});

// ── Type chart & battles ─────────────────────────────────────────────────────

describe('type chart', () => {
  it('strong is 1.5, reverse is 0.5, others and neutral are 1', () => {
    for (const [att, targets] of Object.entries(TYPE_CHART) as [TypeId, TypeId[]][]) {
      for (const t of targets) {
        expect(typeMultiplier(att, t)).toBe(1.5);
        expect(typeMultiplier(t, att)).toBe(0.5);
      }
    }
    expect(typeMultiplier('fire', 'water')).toBe(0.5);
    expect(typeMultiplier('fire', 'psychic')).toBe(1);
    expect(typeMultiplier(NEUTRAL_TYPE, 'fire')).toBe(1);
    expect(typeMultiplier('water', NEUTRAL_TYPE)).toBe(1);
  });
});

function testBattle(defType: TypeId, attType: TypeId, defLvl = 1, attLvl = 1): Battle {
  return {
    kind: 'ambush',
    tile: null,
    stake: 0,
    creditor: null,
    attacker: 0,
    sides: [makeCombatant(null, null, 'D', 1, defType, defLvl), makeCombatant(0, null, 'A', 2, attType, attLvl)],
    turn: 0,
    moves: 0,
    text: [],
    winner: null,
    endReason: null,
    lastHit: null,
  };
}

describe('battle math', () => {
  it('max HP = 20 + 5 × level', () => {
    expect(maxHpFor(1)).toBe(25);
    expect(maxHpFor(5)).toBe(45);
  });

  it('tackle and type-move damage ranges', () => {
    const b = testBattle('fire', 'water', 1, 3);
    const [def, att] = b.sides;
    expect(damageRange(att, def, 'tackle')).toEqual({ min: 12, max: 14 });
    // (8 + 6) × 1.5 = 21, + 0..2
    expect(damageRange(att, def, 'type')).toEqual({ min: 21, max: 23 });
    // resisted: (8 + 2) × 0.5 = 5, + 0..2
    expect(damageRange(def, att, 'type')).toEqual({ min: 5, max: 7 });
  });

  it('damage lands within range, defender moves first, then alternates', () => {
    const b = testBattle('fire', 'water', 1, 1);
    const h = { rng: 123 };
    expect(b.turn).toBe(0);
    applyMove(b, 'tackle', h);
    expect(b.sides[1].hp).toBeGreaterThanOrEqual(25 - 10);
    expect(b.sides[1].hp).toBeLessThanOrEqual(25 - 8);
    expect(b.turn).toBe(1);
    applyMove(b, 'tackle', h);
    expect(b.turn).toBe(0);
    expect(b.moves).toBe(2);
  });

  it('Protect halves the next hit and boosts the next attack, and cannot repeat', () => {
    const b = testBattle(NEUTRAL_TYPE, NEUTRAL_TYPE, 1, 1);
    const h = { rng: 9 };
    applyMove(b, 'protect', h); // defender protects
    expect(b.sides[0].protecting).toBe(true);
    const range = damageRange(b.sides[1], b.sides[0], 'tackle');
    expect(range).toEqual({ min: 4, max: 5 }); // (8..10) × 0.5
    applyMove(b, 'tackle', h);
    expect(b.sides[0].hp).toBeGreaterThanOrEqual(25 - 5);
    expect(b.sides[0].protecting).toBe(false);
    // Defender's next attack is boosted: (8..10) × 1.5
    expect(damageRange(b.sides[0], b.sides[1], 'tackle')).toEqual({ min: 12, max: 15 });
    expect(b.sides[0].usedProtect).toBe(true);
  });

  it('Protect is not legal twice in a row', () => {
    let s = landOn(game(), ambushTile);
    s = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
    s = act(s, { type: 'MOVE', move: 'protect' }); // grunt protects
    s = act(s, TACKLE);
    expect(isLegal(s, { type: 'MOVE', move: 'protect' })).toBe(false);
  });

  it('turn cap: higher HP % wins, ties go to defender', () => {
    const b = testBattle(NEUTRAL_TYPE, NEUTRAL_TYPE, 5, 5);
    b.sides[0].hp = 1000;
    b.sides[0].maxHp = 1000;
    b.sides[1].hp = 1000;
    b.sides[1].maxHp = 1000;
    const h = { rng: 1 };
    for (let i = 0; i < CONFIG.battleMoveCap; i++) applyMove(b, 'tackle', h);
    expect(b.endReason).toBe('cap');
    expect(b.moves).toBe(CONFIG.battleMoveCap);

    const tie = testBattle(NEUTRAL_TYPE, NEUTRAL_TYPE, 1, 1);
    tie.moves = CONFIG.battleMoveCap - 1;
    tie.turn = 0;
    tie.sides[0].protecting = false;
    applyMove(tie, 'protect', h); // no damage; HP 25/25 vs 25/25
    expect(tie.winner).toBe(0);
  });
});

// ── Fee battles ──────────────────────────────────────────────────────────────

describe('fee battles', () => {
  it('paying outright moves the fee to the owner', () => {
    let s = own(game(), 1, firstMon, 2);
    s = landOn(s, firstMon);
    expect(s.phase).toBe('feeChoice');
    const fee = tileFee(s, firstMon);
    s = act(s, { type: 'PAY' });
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - fee);
    expect(s.players[1].cash).toBe(CONFIG.startingMoney + fee);
    expect(s.phase).toBe('endTurn');
  });

  it('losing a fee battle pays the owner; winning pays nothing', () => {
    // Strong defender: attacker (starter Lv1) is very likely to lose vs Lv5.
    let s = own(own(game(), 1, firstMon, 5), 1, partnerOfFirst);
    s = landOn(s, firstMon);
    const fee = tileFee(s, firstMon);
    s = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
    expect(s.battle!.sides[0].owner).toBe(1);
    expect(s.battle!.stake).toBe(fee);
    s = fight(s, TYPE, TACKLE);
    expect(s.phase).toBe('battleOver');
    expect(s.battle!.winner).toBe(0);
    s = act(s, { type: 'ACK' });
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - fee);
    expect(s.players[1].cash).toBe(CONFIG.startingMoney + fee);

    // Strong attacker wins → no fee.
    let w = own(own(game(), 1, firstMon, 1), 0, partnerOfFirst, 1);
    w = edit(w, (d) => (d.players[0].starterLevel = 3));
    w = landOn(w, firstMon);
    w = act(w, { type: 'BATTLE', fighter: { kind: 'starter' } });
    w = fight(w, TACKLE, TACKLE);
    expect(w.battle!.winner).toBe(1);
    w = act(w, { type: 'ACK' });
    expect(w.players[0].cash).toBe(CONFIG.startingMoney);
    expect(w.players[1].cash).toBe(CONFIG.startingMoney);
  });

  it('a legendary defends at level 3', () => {
    let s = own(game(), 1, legendaries[0]);
    s = landOn(s, legendaries[0]);
    s = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
    expect(s.battle!.sides[0].level).toBe(CONFIG.legendary.battleLevel);
  });
});

// ── Ambush & hideout ─────────────────────────────────────────────────────────

describe('ambush and hideout', () => {
  it('ambush: pay to skip goes to the bank', () => {
    let s = landOn(game(), ambushTile);
    expect(s.phase).toBe('ambushChoice');
    s = act(s, { type: 'PAY' });
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - CONFIG.ambushFee);
  });

  it('grunt level scales with round', () => {
    let s = edit(game(), (d) => (d.round = 11));
    s = landOn(s, ambushTile);
    s = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
    expect(s.battle!.sides[0].level).toBe(3);
    expect(s.battle!.sides[0].owner).toBeNull();
  });

  function inHideout(): GameState {
    return edit(game(), (d) => {
      d.players[0].position = HIDEOUT_TILE;
      d.players[0].inHideout = true;
      d.phase = 'hideout';
    });
  }

  it('paying frees you and lets you roll', () => {
    let s = act(inHideout(), { type: 'PAY' });
    expect(s.players[0].inHideout).toBe(false);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - CONFIG.hideout.fee);
    expect(s.phase).toBe('roll');
  });

  it('beating the guard frees you for free', () => {
    let s = edit(inHideout(), (d) => (d.players[0].starterLevel = 3));
    s = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
    s = fight(s, TACKLE, TACKLE);
    expect(s.battle!.winner).toBe(1);
    s = act(s, { type: 'ACK' });
    expect(s.players[0].inHideout).toBe(false);
    expect(s.phase).toBe('roll');
    expect(s.players[0].cash).toBe(CONFIG.startingMoney);
  });

  it('losing ends the turn; the 3rd loss auto-pays and lets you roll', () => {
    let s = edit(inHideout(), (d) => (d.round = 20)); // grunt Lv4 vs starter Lv1
    for (let fail = 1; fail <= CONFIG.hideout.maxFailedTurns; fail++) {
      s = edit(s, (d) => {
        d.current = 0;
        d.phase = 'hideout';
      });
      s = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
      s = fight(s, TYPE, TACKLE);
      expect(s.battle!.winner).toBe(0);
      s = act(s, { type: 'ACK' });
      if (fail < CONFIG.hideout.maxFailedTurns) {
        expect(s.phase).toBe('endTurn');
        expect(s.players[0].hideoutFails).toBe(fail);
        expect(s.players[0].inHideout).toBe(true);
      }
    }
    expect(s.players[0].inHideout).toBe(false);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - CONFIG.hideout.fee);
    expect(s.phase).toBe('roll');
  });

  it('escape rope frees you', () => {
    let s = edit(inHideout(), (d) => (d.players[0].escapeRopes = 1));
    s = act(s, { type: 'USE_ROPE' });
    expect(s.players[0].inHideout).toBe(false);
    expect(s.players[0].escapeRopes).toBe(0);
    expect(s.phase).toBe('roll');
  });

  it('a player in the hideout starts their turn in the hideout phase and still collects fees', () => {
    let s = edit(own(game(), 1, firstMon), (d) => {
      d.players[1].position = HIDEOUT_TILE;
      d.players[1].inHideout = true;
    });
    s = landOn(s, firstMon);
    s = act(s, { type: 'PAY' });
    expect(s.players[1].cash).toBe(CONFIG.startingMoney + tileFee(s, firstMon));
    s = act(s, { type: 'END_TURN' });
    expect(s.current).toBe(1);
    expect(s.phase).toBe('hideout');
  });
});

// ── Cards ────────────────────────────────────────────────────────────────────

describe('cards', () => {
  it('landing on a card tile draws a card and waits for OK', () => {
    const s = landOn(game(), cardTile);
    expect(s.phase).toBe('card');
    expect(s.pendingCard).not.toBeNull();
    expect(s.deckPos).toBe(1);
  });

  it('reshuffles when the deck runs out', () => {
    let s = edit(game(), (d) => (d.deckPos = d.deck.length));
    s = landOn(s, cardTile);
    expect(s.deckPos).toBe(1);
  });

  CONFIG.cards.forEach((effect, i) => {
    if (effect.kind === 'gain') {
      it(`card ${i}: gain ${effect.amount}`, () => {
        const s = drawCard(game(), i);
        expect(s.players[0].cash).toBe(CONFIG.startingMoney + effect.amount);
      });
    }
    if (effect.kind === 'lose') {
      it(`card ${i}: lose ${effect.amount}`, () => {
        const s = drawCard(game(), i);
        expect(s.players[0].cash).toBe(CONFIG.startingMoney - effect.amount);
      });
    }
  });

  it('rare candy levels the highest-fee creature for free, else pays the fallback', () => {
    const rc = cardIndex('rareCandy');
    let s = own(own(game(), 0, firstMon), 0, legendaries[0]);
    const expensive = idx((t, j) => t.kind === 'pokemon' && tilePrice(BASE, j) > tilePrice(BASE, firstMon));
    s = own(s, 0, expensive);
    s = drawCard(s, rc);
    expect(s.tiles[expensive].level).toBe(2);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney);

    // No tiles → starter.
    let st = drawCard(game(), rc);
    expect(st.players[0].starterLevel).toBe(2);

    // Nothing can level → fallback cash.
    st = edit(game(), (d) => (d.players[0].starterLevel = CONFIG.starter.maxLevel));
    st = own(st, 0, firstMon, CONFIG.setRuleCap);
    st = drawCard(st, rc);
    const fb = (CONFIG.cards[rc] as { fallback: number }).fallback;
    expect(st.players[0].cash).toBe(CONFIG.startingMoney + fb);
  });

  it('fly: advance to GO and collect', () => {
    let s = edit(game(), (d) => (d.players[0].position = cardTile));
    s = drawCard(s, cardIndex('advanceToGo'));
    expect(s.players[0].position).toBe(GO_TILE);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney + CONFIG.goPayout);
  });

  it('move forward 3 and resolve (with GO money if passed)', () => {
    const fwd = cardIndex('move', (c) => c.kind === 'move' && c.steps > 0);
    let s = edit(game(), (d) => (d.players[0].position = BOARD_SIZE - 1));
    s = drawCard(s, fwd);
    expect(s.players[0].position).toBe(2);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney + CONFIG.goPayout);
    expect(s.phase).toBe('card'); // tile 2 is a card tile → resolved
  });

  it('move back 3 and resolve, no GO money', () => {
    const back = cardIndex('move', (c) => c.kind === 'move' && c.steps < 0);
    let s = edit(game(), (d) => (d.players[0].position = cardTile));
    s = drawCard(s, back);
    expect(s.players[0].position).toBe((cardTile - 3 + BOARD_SIZE) % BOARD_SIZE);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney);
    expect(s.phase).toBe('buy');
  });

  it('team rocket: go to hideout', () => {
    const s = drawCard(game(), cardIndex('goToHideout'));
    expect(s.players[0].inHideout).toBe(true);
    expect(s.players[0].position).toBe(HIDEOUT_TILE);
  });

  it('escape rope is kept', () => {
    const s = drawCard(game(), cardIndex('escapeRope'));
    expect(s.players[0].escapeRopes).toBe(1);
  });

  it('birthday: every other player pays you', () => {
    const bd = cardIndex('birthday');
    const amount = (CONFIG.cards[bd] as { amount: number }).amount;
    const s = drawCard(game(4), bd);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney + 3 * amount);
    expect(s.players.slice(1).every((p) => p.cash === CONFIG.startingMoney - amount)).toBe(true);
    expect(s.phase).toBe('endTurn');
  });
});

// ── Debt ─────────────────────────────────────────────────────────────────────

describe('liquidation and bankruptcy', () => {
  it('opens liquidation when short and resumes after releasing enough', () => {
    let s = own(own(game(), 1, legendaries[0]), 0, firstMon, 2);
    s = edit(s, (d) => (d.players[0].cash = 10));
    s = landOn(s, legendaries[0]);
    s = act(s, { type: 'PAY' });
    expect(s.phase).toBe('debt');
    expect(s.debt!.amount).toBe(50);
    const value = releaseValue(s, firstMon);
    expect(value).toBe(Math.round((tilePrice(BASE, firstMon) + levelCost(BASE, firstMon)) * CONFIG.liquidationRatio));
    s = act(s, { type: 'RELEASE', tile: firstMon });
    expect(s.tiles[firstMon]).toEqual({ owner: null, level: 1 });
    expect(s.players[0].cash).toBe(10 + value - 50);
    expect(s.players[1].cash).toBe(CONFIG.startingMoney + 50);
    expect(s.phase).toBe('endTurn');
  });

  it('goes bankrupt when nothing is left; creditor gets the remaining cash; last standing wins', () => {
    let s = own(game(), 1, legendaries[0]);
    s = edit(s, (d) => (d.players[0].cash = 20));
    s = landOn(s, legendaries[0]);
    s = act(s, { type: 'PAY' });
    expect(s.players[0].bankrupt).toBe(true);
    expect(s.players[1].cash).toBe(CONFIG.startingMoney + 20);
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe(1);
  });

  it('bankrupt players are skipped in turn order', () => {
    let s = own(game(3), 1, legendaries[0]);
    s = edit(s, (d) => (d.players[0].cash = 0));
    s = landOn(s, legendaries[0]);
    s = act(s, { type: 'PAY' });
    expect(s.players[0].bankrupt).toBe(true);
    expect(s.phase).toBe('roll');
    expect(s.current).toBe(1);
    s = edit(s, (d) => (d.phase = 'endTurn'));
    s = act(s, { type: 'END_TURN' });
    s = edit(s, (d) => (d.phase = 'endTurn'));
    s = act(s, { type: 'END_TURN' });
    expect(s.current).toBe(1);
  });
});

// ── Rounds & winning ─────────────────────────────────────────────────────────

describe('rounds and winning', () => {
  it('round advances after everyone has played', () => {
    let s = edit(game(3), (d) => (d.phase = 'endTurn'));
    s = act(s, { type: 'END_TURN' });
    expect(s.round).toBe(1);
    s = act(edit(s, (d) => (d.phase = 'endTurn')), { type: 'END_TURN' });
    s = act(edit(s, (d) => (d.phase = 'endTurn')), { type: 'END_TURN' });
    expect(s.round).toBe(2);
    expect(s.current).toBe(0);
  });

  it('round limit ends the game; highest net worth wins', () => {
    let s = edit(game(2, 1, 10), (d) => {
      d.round = 10;
      d.current = 1;
      d.phase = 'endTurn';
      d.players[0].cash = 100;
      d.tiles[firstMon] = { owner: 0, level: 1 };
    });
    s = act(s, { type: 'END_TURN' });
    expect(s.phase).toBe('gameOver');
    expect(s.winner).toBe(1);
    expect(netWorth(s, 0)).toBe(100 + tilePrice(BASE, firstMon));
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('determinism', () => {
  function playBots(seed: number, maxSteps = 4000): { state: GameState; actions: Action[] } {
    let s = createGame(
      {
        players: Array.from({ length: 4 }, (_, i) => ({ name: `B${i}`, color: '#000', isBot: true, starter: i })),
        roundLimit: 30,
      },
      seed,
    );
    const actions: Action[] = [];
    for (let i = 0; i < maxSteps && s.phase !== 'gameOver'; i++) {
      const a = chooseAction(s);
      const next = reduce(s, a);
      expect(next).not.toBe(s); // bots only choose legal actions
      actions.push(a);
      s = next;
    }
    return { state: s, actions };
  }

  it('same seed + same actions = same state', () => {
    const { state, actions } = playBots(7, 600);
    let replay = createGame(
      {
        players: Array.from({ length: 4 }, (_, i) => ({ name: `B${i}`, color: '#000', isBot: true, starter: i })),
        roundLimit: 30,
      },
      7,
    );
    for (const a of actions) replay = reduce(replay, a);
    expect(replay).toEqual(state);
  });

  it('full bot games finish', () => {
    for (const seed of [1, 2, 3]) {
      const { state } = playBots(seed, 20000);
      expect(state.phase).toBe('gameOver');
      expect(state.winner).not.toBeNull();
    }
  });

  it('state survives JSON round-trip (save/load)', () => {
    const { state } = playBots(11, 300);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

// ── Battle-loss surcharge ────────────────────────────────────────────────────

describe('battle-loss surcharge', () => {
  const withSurcharge = (v: number, fn: () => void) => {
    const old = CONFIG.battleLossSurcharge;
    CONFIG.battleLossSurcharge = v;
    try {
      fn();
    } finally {
      CONFIG.battleLossSurcharge = old;
    }
  };

  it('paying costs the plain fee; battling and losing costs fee × (1 + surcharge); winning costs nothing', () =>
    withSurcharge(0.25, () => {
      let s = own(own(game(), 1, firstMon, 5), 1, partnerOfFirst);
      s = landOn(s, firstMon);
      const fee = tileFee(s, firstMon);
      expect(challengeCosts(s)).toEqual({ pay: fee, loseBattle: Math.round(fee * 1.25) });

      const paid = act(s, { type: 'PAY' });
      expect(paid.players[0].cash).toBe(CONFIG.startingMoney - fee);

      let lost = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
      expect(lost.battle!.stake).toBe(Math.round(fee * 1.25));
      lost = fight(lost, TYPE, TACKLE);
      expect(lost.battle!.winner).toBe(0);
      lost = act(lost, { type: 'ACK' });
      expect(lost.players[0].cash).toBe(CONFIG.startingMoney - Math.round(fee * 1.25));
      expect(lost.players[1].cash).toBe(CONFIG.startingMoney + Math.round(fee * 1.25));
    }));

  it('applies to the ambush tile: skip pays the ambush fee, a lost battle pays the surcharged amount', () =>
    withSurcharge(0.25, () => {
      const s = landOn(edit(game(), (d) => (d.round = 20)), ambushTile);
      expect(challengeCosts(s)).toEqual({ pay: CONFIG.ambushFee, loseBattle: Math.round(CONFIG.ambushFee * 1.25) });
      expect(act(s, { type: 'PAY' }).players[0].cash).toBe(CONFIG.startingMoney - CONFIG.ambushFee);
      let lost = act(s, { type: 'BATTLE', fighter: { kind: 'starter' } });
      lost = fight(lost, TYPE, TACKLE);
      expect(lost.battle!.winner).toBe(0);
      lost = act(lost, { type: 'ACK' });
      expect(lost.players[0].cash).toBe(CONFIG.startingMoney - Math.round(CONFIG.ambushFee * 1.25));
    }));

  it('at 0 the stake equals the plain fee (rule off)', () =>
    withSurcharge(0, () => {
      const s = landOn(own(game(), 1, firstMon, 2), firstMon);
      const c = challengeCosts(s)!;
      expect(c.loseBattle).toBe(c.pay);
    }));
});

describe('GO payout', () => {
  it('passing GO and the Fly card both pay the configured amount', () => {
    let s = edit(game(), (d) => (d.players[0].position = cardTile));
    s = drawCard(s, cardIndex('advanceToGo'));
    expect(s.players[0].cash).toBe(CONFIG.startingMoney + CONFIG.goPayout);
  });
});
