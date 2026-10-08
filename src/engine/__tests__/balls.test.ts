import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../data/config';
import { migrateSave } from '../board';
import { chooseAction } from '../bot';
import { createGame, reduce } from '../reducer';
import { catchChance, isLegal, legalActions, netWorth, tilePrice } from '../selectors';
import type { Action, GameState } from '../types';

function game(seed = 3): GameState {
  return createGame(
    {
      players: [0, 1].map((i) => ({ name: `P${i + 1}`, color: '#000', isBot: false, starter: i })),
      roundLimit: 20,
    },
    seed,
  );
}
function act(s: GameState, a: Action): GameState {
  expect(isLegal(s, a), `illegal ${JSON.stringify(a)} in ${s.phase}`).toBe(true);
  return reduce(s, a);
}
const edit = (s: GameState, fn: (d: GameState) => void) => {
  const d = structuredClone(s);
  fn(d);
  return d;
};
/** Put the current player on the unowned tile i, deciding whether to catch it. */
const landed = (s: GameState, i: number) =>
  edit(s, (d) => {
    d.players[d.current].position = i;
    d.phase = 'buy';
    d.pendingTile = i;
    d.shopClosed = true;
  });

const BASE = game();
const tileWithPrice = (price: number) => BASE.board.findIndex((t, i) => t.kind === 'pokemon' && tilePrice(BASE, i) === price);
const LEGEND = BASE.board.findIndex((t) => t.kind === 'legendary');
const cost = CONFIG.balls.cost;

describe('inventory and shop', () => {
  it('every player starts with the configured balls', () => {
    for (const p of BASE.players) expect(p.balls).toEqual(CONFIG.balls.starting);
  });

  it('buying costs cash, adds a ball, and is limited by the bag and by cash', () => {
    let s = act(BASE, { type: 'BUY_BALL', ball: 'great' });
    expect(s.players[0].balls.great).toBe(1);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - cost.great);
    // Starting 2 + 1 = 3 = full bag.
    expect(isLegal(s, { type: 'BUY_BALL', ball: 'poke' })).toBe(false);
    const broke = edit(BASE, (d) => (d.players[0].cash = cost.ultra - 1));
    expect(isLegal(broke, { type: 'BUY_BALL', ball: 'ultra' })).toBe(false);
    expect(isLegal(broke, { type: 'BUY_BALL', ball: 'poke' })).toBe(true);
  });

  it('the shop closes on rolling and on the hideout choice, and reopens next turn', () => {
    let s = act(BASE, { type: 'ROLL' });
    expect(legalActions(s).some((a) => a.type === 'BUY_BALL')).toBe(false);
    // Even if the turn returns to a roll phase (e.g. after escaping the hideout), it stays closed.
    expect(isLegal(edit(s, (d) => (d.phase = 'roll')), { type: 'BUY_BALL', ball: 'poke' })).toBe(false);

    let h = edit(BASE, (d) => {
      d.phase = 'hideout';
      d.players[0].inHideout = true;
    });
    expect(isLegal(h, { type: 'BUY_BALL', ball: 'poke' })).toBe(true);
    h = act(h, { type: 'PAY' });
    expect(h.phase).toBe('roll');
    expect(isLegal(h, { type: 'BUY_BALL', ball: 'poke' })).toBe(false);

    const next = act(edit(s, (d) => (d.phase = 'endTurn')), { type: 'END_TURN' });
    expect(isLegal(next, { type: 'BUY_BALL', ball: 'poke' })).toBe(true);
  });
});

describe('catch chance', () => {
  const t100 = tileWithPrice(100);
  const t220 = tileWithPrice(220);
  const t400 = tileWithPrice(400);

  it("matches the brief's example table at power = cost × 1.2", () => {
    const old = CONFIG.balls.powerMultiplier;
    CONFIG.balls.powerMultiplier = 1.2;
    try {
      expect(catchChance(BASE, t100, 'poke')).toBeCloseTo(0.6);
      expect(catchChance(BASE, t100, 'great')).toBeCloseTo(0.95); // capped
      expect(catchChance(BASE, t220, 'great')).toBeCloseTo(120 / 220);
      expect(catchChance(BASE, t220, 'ultra')).toBeCloseTo(0.95);
      expect(catchChance(BASE, t400, 'poke')).toBeCloseTo(0.15);
      expect(catchChance(BASE, t400, 'ultra')).toBeCloseTo(0.6);
      expect(catchChance(BASE, LEGEND, 'poke')).toBeCloseTo(0.15);
      expect(catchChance(BASE, LEGEND, 'great')).toBeCloseTo(0.3);
      expect(catchChance(BASE, LEGEND, 'ultra')).toBeCloseTo(0.6);
    } finally {
      CONFIG.balls.powerMultiplier = old;
    }
  });

  it('= min(cap, cost × multiplier / price), legendaries × the legendary multiplier, Master Ball 100%', () => {
    const b = CONFIG.balls;
    for (const ball of ['poke', 'great', 'ultra'] as const) {
      for (const t of [t100, t220, t400]) {
        expect(catchChance(BASE, t, ball)).toBeCloseTo(Math.min(b.maxChance, (b.cost[ball] * b.powerMultiplier) / tilePrice(BASE, t)));
      }
      expect(catchChance(BASE, LEGEND, ball)).toBeCloseTo(
        Math.min(b.maxChance, ((b.cost[ball] * b.powerMultiplier) / tilePrice(BASE, LEGEND)) * b.legendaryMultiplier),
      );
    }
    expect(catchChance(BASE, t400, 'master')).toBe(1);
  });
});

describe('throwing', () => {
  const t400 = tileWithPrice(400);

  /** Find a seed whose first throw of a Poké Ball at a ₽400 tile (15%) catches / misses. */
  function throwWith(wantCaught: boolean): { before: GameState; after: GameState } {
    for (let seed = 1; seed < 500; seed++) {
      const before = landed(game(seed), t400);
      const after = act(before, { type: 'THROW', ball: 'poke' });
      if (after.lastThrow!.caught === wantCaught) return { before, after };
    }
    throw new Error('no seed found');
  }

  it('a successful throw catches at level 1 and uses up the ball', () => {
    const { before, after } = throwWith(true);
    expect(after.tiles[t400]).toEqual({ owner: 0, level: 1 });
    expect(after.players[0].balls.poke).toBe(before.players[0].balls.poke - 1);
    expect(after.players[0].cash).toBe(before.players[0].cash);
    expect(after.lastThrow).toMatchObject({ caught: true, shakes: 3, ball: 'poke', tile: t400 });
    expect(after.log.at(-1)!.text).toMatch(/threw a .+ at .+… caught!/);
  });

  it('a failed throw leaves the tile unowned, still uses the ball, and ends the landing', () => {
    const { before, after } = throwWith(false);
    expect(after.tiles[t400].owner).toBeNull();
    expect(after.players[0].balls.poke).toBe(before.players[0].balls.poke - 1);
    expect(after.lastThrow!.caught).toBe(false);
    expect(after.lastThrow!.shakes).toBeGreaterThanOrEqual(0);
    expect(after.lastThrow!.shakes).toBeLessThanOrEqual(2);
    expect(after.log.at(-1)!.text).toMatch(/it broke free!/);
    // One throw per landing: no second ball and no Master Ball.
    expect(after.phase).toBe('endTurn');
    expect(legalActions(after).some((a) => a.type === 'THROW')).toBe(false);
  });

  it('only carried balls can be thrown', () => {
    const s = landed(BASE, t400);
    expect(isLegal(s, { type: 'THROW', ball: 'great' })).toBe(false);
    expect(isLegal(s, { type: 'THROW', ball: 'poke' })).toBe(true);
  });

  it('the Master Ball costs the tile price, always catches, and plays 3 shakes', () => {
    const s = act(landed(BASE, t400), { type: 'THROW', ball: 'master' });
    expect(s.tiles[t400].owner).toBe(0);
    expect(s.players[0].cash).toBe(CONFIG.startingMoney - 400);
    expect(s.lastThrow).toMatchObject({ caught: true, shakes: 3, ball: 'master' });
  });

  it('net worth uses the tile price, not what the ball cost', () => {
    const { after } = throwWith(true);
    expect(netWorth(after, 0)).toBe(after.players[0].cash + 400);
  });

  it('same seed + same actions = same catches', () => {
    const run = () => {
      let s = createGame({ players: [0, 1, 2, 3].map((i) => ({ name: `B${i}`, color: '#000', isBot: true, starter: i })), roundLimit: 20, boardMode: 'shuffled' }, 77);
      for (let k = 0; k < 600 && s.phase !== 'gameOver'; k++) s = reduce(s, chooseAction(s));
      return s;
    };
    expect(run()).toEqual(run());
  });
});

describe('ball cards', () => {
  const cardOf = (ball: string) => CONFIG.cards.findIndex((c) => c.kind === 'gainBall' && c.ball === ball);
  const draw = (s: GameState, card: number) =>
    act(
      edit(s, (d) => {
        d.phase = 'card';
        d.pendingCard = card;
      }),
      { type: 'ACK' },
    );

  for (const [ball, fallback] of [['great', 50], ['ultra', 100]] as const) {
    it(`gain a ${ball} ball, or ₽${fallback} with a full bag`, () => {
      const got = draw(BASE, cardOf(ball));
      expect(got.players[0].balls[ball]).toBe(BASE.players[0].balls[ball] + 1);
      const full = edit(BASE, (d) => (d.players[0].balls = { poke: CONFIG.balls.carryLimit, great: 0, ultra: 0 }));
      const sold = draw(full, cardOf(ball));
      expect(sold.players[0].balls[ball]).toBe(0);
      expect(sold.players[0].cash).toBe(CONFIG.startingMoney + fallback);
    });
  }

  it('the deck has 14 cards', () => {
    expect(CONFIG.cards).toHaveLength(14);
    expect(BASE.deck).toHaveLength(14);
  });
});

describe('bankruptcy and migration', () => {
  it('a bankrupt player loses their balls', () => {
    let s = edit(BASE, (d) => {
      d.players[0].cash = 0;
      d.tiles[LEGEND] = { owner: 1, level: 1 };
      d.players[0].position = LEGEND;
      d.phase = 'feeChoice';
      d.pendingTile = LEGEND;
    });
    s = act(s, { type: 'PAY' });
    expect(s.players[0].bankrupt).toBe(true);
    expect(s.players[0].balls).toEqual({ poke: 0, great: 0, ultra: 0 });
  });

  it('a save from before balls loads with empty bags and keeps playing', () => {
    const old = JSON.parse(JSON.stringify(BASE));
    for (const p of old.players) delete p.balls;
    delete old.shopClosed;
    delete old.shopBuys;
    delete old.lastThrow;
    let s = migrateSave(old as GameState);
    expect(s.players.every((p) => p.balls.poke + p.balls.great + p.balls.ultra === 0)).toBe(true);
    for (let k = 0; k < 200 && s.phase !== 'gameOver'; k++) {
      const a = chooseAction(s);
      expect(isLegal(s, a)).toBe(true);
      s = reduce(s, a);
    }
  });
});
