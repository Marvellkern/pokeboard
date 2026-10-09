import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../data/config';
import { migrateSave } from '../board';
import { botAccepts, chooseAction } from '../bot';
import { createGame, reduce } from '../reducer';
import { isLegal, legalActions, levelCost, levelUpCheck, tileFee, tradeCheck } from '../selectors';
import { tradeEffects } from '../trade';
import type { Action, GameState, PlayerId, TradeOffer } from '../types';

// Classic board: pair slots A [1,3], B [5,6], C [8,9], D [12,13], E [15,17], F [19,20], G [22,23],
// H [26,27]; legendaries on 4, 11, 18, 25.

function game(players = 2, bots = false, seed = 3): GameState {
  return createGame(
    {
      players: Array.from({ length: players }, (_, i) => ({ name: `P${i + 1}`, color: '#000', isBot: bots, starter: i })),
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
/** Give tiles to players: [tile, owner, level]. */
const own = (s: GameState, list: [number, PlayerId, number?][]) =>
  edit(s, (d) => {
    for (const [i, owner, level] of list) d.tiles[i] = { owner, level: level ?? 1 };
  });
const offer = (to: PlayerId, give: number[], giveMoney: number, receive: number[], receiveMoney: number): TradeOffer => ({
  to,
  give: { tiles: give, money: giveMoney },
  receive: { tiles: receive, money: receiveMoney },
});
const propose = (o: TradeOffer): Action => ({ type: 'PROPOSE_TRADE', ...o });
const accept: Action = { type: 'RESPOND_TRADE', accept: true };
const decline: Action = { type: 'RESPOND_TRADE', accept: false };
const START = CONFIG.startingMoney;

describe('trading: offers and answers', () => {
  it('moves creatures and money both ways on accept', () => {
    let s = own(game(), [
      [1, 0],
      [5, 1],
    ]);
    s = act(s, propose(offer(1, [1], 50, [5], 20)));
    expect(s.phase).toBe('trade');
    s = act(s, { ...accept, by: 1 });
    expect(s.tiles[1].owner).toBe(1);
    expect(s.tiles[5].owner).toBe(0);
    expect(s.players[0].cash).toBe(START - 50 + 20);
    expect(s.players[1].cash).toBe(START + 50 - 20);
    expect(s.phase).toBe('roll');
    expect(s.lastTrade?.outcome).toBe('accepted');
    expect(s.log.at(-1)!.text).toBe(`P2 accepted: P1 gets ${s.board[5].name} + ₽20, P2 gets ${s.board[1].name} + ₽50.`);
  });

  it('declining moves nothing and still uses the offer', () => {
    let s = own(game(), [
      [1, 0],
      [5, 1],
    ]);
    s = act(s, propose(offer(1, [1], 0, [5], 0)));
    s = act(s, decline);
    expect(s.tiles[1].owner).toBe(0);
    expect(s.players[0].cash).toBe(START);
    expect(s.log.at(-1)!.text).toBe('P2 declined.');
    expect(isLegal(s, propose(offer(1, [1], 0, [5], 0)))).toBe(false);
    expect(tradeCheck(s, offer(1, [1], 0, [5], 0)).reason).toBe('used');
  });

  it('the offer limit resets on the next turn', () => {
    let s = own(game(), [
      [1, 0],
      [5, 1],
    ]);
    s = act(s, propose(offer(1, [1], 0, [5], 0)));
    s = act(s, decline);
    s = edit(s, (d) => (d.phase = 'endTurn'));
    s = act(s, { type: 'END_TURN' });
    expect(s.current).toBe(1);
    expect(isLegal(s, propose(offer(0, [5], 0, [1], 0)))).toBe(true);
  });

  it('a traded creature resets to level 1 (and its first form)', () => {
    let s = own(game(), [
      [8, 0, 2],
      [1, 1],
    ]);
    const o = offer(1, [8], 0, [1], 0);
    expect(tradeEffects(s, o)).toContainEqual({ kind: 'reset', player: 0, tile: 8, fromLevel: 2, lost: levelCost(s, 8) });
    s = act(s, propose(o));
    s = act(s, accept);
    expect(s.tiles[8]).toEqual({ owner: 1, level: 1 });
  });

  it('breaking a pair drops the kept partner to level 2, with no refund', () => {
    let s = own(game(), [
      [12, 0, 4],
      [13, 0, 3],
      [1, 1],
    ]);
    const o = offer(1, [12], 0, [1], 0);
    const effects = tradeEffects(s, o);
    expect(effects).toContainEqual({ kind: 'pairBroken', player: 0, tile: 13, type: s.board[13].type, fromLevel: 3, toLevel: 2, lost: levelCost(s, 13) });
    expect(effects).toContainEqual({ kind: 'reset', player: 0, tile: 12, fromLevel: 4, lost: 3 * levelCost(s, 12) });
    s = act(s, propose(o));
    s = act(s, accept);
    expect(s.tiles[13]).toEqual({ owner: 0, level: 2 });
    expect(s.tiles[12]).toEqual({ owner: 1, level: 1 });
    expect(s.players[0].cash).toBe(START);
  });

  it('completing a pair by trade allows level 3', () => {
    let s = own(game(), [
      [15, 0, 2],
      [17, 1],
    ]);
    expect(levelUpCheck(s, 0, { kind: 'tile', tile: 15 }).reason).toBe('needPair');
    const o = offer(1, [], 400, [17], 0);
    expect(tradeEffects(s, o)).toContainEqual({ kind: 'pairCompleted', player: 0, type: s.board[15].type, tiles: [15, 17] });
    s = act(s, propose(o));
    s = act(s, accept);
    expect(s.phase).toBe('roll');
    s = act(s, { type: 'LEVEL_UP', target: { kind: 'tile', tile: 15 } });
    expect(s.tiles[15].level).toBe(3);
  });

  it('legendary fees are recounted for both players', () => {
    let s = own(game(), [
      [4, 0],
      [11, 0],
      [1, 1],
    ]);
    expect(tileFee(s, 11)).toBe(CONFIG.legendary.feeByCount[2]);
    const o = offer(1, [4], 0, [1], 0);
    const effects = tradeEffects(s, o);
    expect(effects).toContainEqual({ kind: 'legendaryFee', player: 0, before: CONFIG.legendary.feeByCount[2], after: CONFIG.legendary.feeByCount[1] });
    expect(effects).toContainEqual({ kind: 'legendaryFee', player: 1, before: 0, after: CONFIG.legendary.feeByCount[1] });
    s = act(s, propose(o));
    s = act(s, accept);
    expect(tileFee(s, 11)).toBe(CONFIG.legendary.feeByCount[1]);
    expect(tileFee(s, 4)).toBe(CONFIG.legendary.feeByCount[1]);
  });

  it('each side must give something (but ₽1 for a creature is fine)', () => {
    const s = own(game(), [
      [1, 0],
      [5, 1],
    ]);
    expect(tradeCheck(s, offer(1, [], 0, [5], 0)).reason).toBe('empty');
    expect(tradeCheck(s, offer(1, [1], 0, [], 0)).reason).toBe('empty');
    expect(tradeCheck(s, offer(1, [], 1, [5], 0)).ok).toBe(true);
  });

  it('only owned creatures and money you have can be offered', () => {
    const s = own(game(3), [
      [1, 0],
      [5, 1],
      [8, 2],
    ]);
    const bad: [TradeOffer, string][] = [
      [offer(1, [0], 0, [5], 0), 'tiles'], // GO is not a creature
      [offer(1, [3], 0, [5], 0), 'tiles'], // unowned
      [offer(1, [5], 0, [1], 0), 'tiles'], // not mine to give
      [offer(1, [1], 0, [8], 0), 'tiles'], // the third player's
      [offer(1, [1, 1], 0, [5], 0), 'tiles'],
      [offer(1, [1], START + 1, [5], 0), 'money'],
      [offer(1, [1], -5, [5], 0), 'money'],
      [offer(1, [1], 2.5, [5], 0), 'money'],
      [offer(1, [1], 0, [5], START + 1), 'money'],
      [offer(0, [1], 0, [5], 0), 'player'],
      [offer(7, [1], 0, [5], 0), 'player'],
    ];
    for (const [o, reason] of bad) expect(tradeCheck(s, o).reason, JSON.stringify(o)).toBe(reason);
  });

  it('starters and balls are never tradeable', () => {
    const s = own(game(), [[5, 1]]);
    const withBalls = { to: 1, give: { tiles: [], money: 0, balls: { poke: 1 } }, receive: { tiles: [5], money: 0 } } as unknown as TradeOffer;
    expect(isLegal(s, propose(withBalls))).toBe(false);
    const withStarter = { ...offer(1, [], 0, [5], 0), starter: 0 } as unknown as TradeOffer;
    expect(isLegal(s, propose(withStarter))).toBe(false);
    // A side with nothing but a starter has nothing tradeable in it.
    expect(isLegal(s, propose(offer(1, [-1], 0, [5], 0)))).toBe(false);
  });

  it('offers are blocked during a catch, a fee, a battle, a card, a debt, and on other turns', () => {
    const base = own(game(), [
      [1, 0],
      [5, 1],
    ]);
    const o = propose(offer(1, [1], 0, [5], 0));
    for (const phase of ['buy', 'feeChoice', 'ambushChoice', 'card', 'battle', 'battleOver', 'debt', 'gameOver'] as const) {
      const s = edit(base, (d) => (d.phase = phase));
      expect(tradeCheck(s, offer(1, [1], 0, [5], 0)).reason, phase).toBe('phase');
    }
    // Allowed before rolling, in the hideout, and before ending the turn.
    for (const phase of ['roll', 'hideout', 'endTurn'] as const) {
      expect(isLegal(edit(base, (d) => (d.phase = phase)), o), phase).toBe(true);
    }
    // Only the current player proposes.
    expect(isLegal(base, { ...o, by: 1 })).toBe(false);
  });

  it('a pending offer blocks every other action; only the recipient answers', () => {
    let s = own(game(3), [
      [1, 0],
      [5, 1],
    ]);
    s = act(s, propose(offer(1, [1], 0, [5], 0)));
    expect(legalActions(s)).toEqual([accept, decline]);
    for (const a of [{ type: 'ROLL' }, { type: 'END_TURN' }, { type: 'BUY_BALL', ball: 'poke' }, { type: 'LEVEL_UP', target: { kind: 'starter' } }] as Action[]) {
      expect(isLegal(s, a), a.type).toBe(false);
    }
    expect(isLegal(s, propose(offer(2, [1], 0, [], 0)))).toBe(false);
    expect(isLegal(s, { ...accept, by: 0 })).toBe(false);
    expect(isLegal(s, { ...accept, by: 2 })).toBe(false);
    expect(isLegal(s, { ...accept, by: 1 })).toBe(true);
  });

  it('is checked again at acceptance and cancelled if it no longer adds up', () => {
    let s = own(game(), [
      [1, 0],
      [5, 1],
    ]);
    s = act(s, propose(offer(1, [1], 100, [5], 0)));
    s = edit(s, (d) => (d.players[0].cash = 40)); // can't pay the ₽100 any more
    s = act(s, accept);
    expect(s.lastTrade?.outcome).toBe('cancelled');
    expect(s.tiles[1].owner).toBe(0);
    expect(s.tiles[5].owner).toBe(1);
    expect(s.players[1].cash).toBe(START);
    expect(s.tradeOffers).toBe(1);
    expect(s.log.at(-1)!.text).toContain('cancelled');
  });

  it("doesn't close the shop", () => {
    let s = own(game(), [
      [1, 0],
      [5, 1],
    ]);
    s = act(s, propose(offer(1, [1], 0, [5], 0)));
    s = act(s, decline);
    expect(s.shopClosed).toBe(false);
    expect(isLegal(s, { type: 'BUY_BALL', ball: 'poke' })).toBe(true);
  });

  it('old saves without trade fields load and can trade', () => {
    const old = own(game(), [
      [1, 0],
      [5, 1],
    ]) as Partial<GameState>;
    delete old.pendingTrade;
    delete old.tradeOffers;
    delete old.lastTrade;
    delete old.tradeDeclines;
    const s = migrateSave(old as GameState);
    expect(s.pendingTrade).toBeNull();
    expect(s.tradeOffers).toBe(0);
    expect(s.tradeDeclines).toEqual([]);
    const t = act(act(s, propose(offer(1, [1], 0, [5], 0))), accept);
    expect(t.tiles[5].owner).toBe(0);
  });
});

describe('trading: bots', () => {
  it('accepts a clearly good offer and declines a clearly bad one', () => {
    const s = own(game(2, true), [
      [1, 0],
      [26, 1],
    ]);
    expect(botAccepts(s, { ...offer(1, [], 1000, [26], 0), from: 0 }, 1)).toBe(true);
    expect(botAccepts(s, { ...offer(1, [], 1, [26], 0), from: 0 }, 1)).toBe(false);
    // Answers through chooseAction too.
    const pending = reduce(s, propose(offer(1, [], 1, [26], 0)));
    expect(chooseAction(pending)).toEqual(decline);
  });

  it("won't hand over a pair-completing tile for its plain price", () => {
    const s = own(game(2, true), [
      [15, 0],
      [17, 1],
    ]);
    // Price 260: ₽300 doesn't cover price + danger premium + margin.
    expect(botAccepts(s, { ...offer(1, [], 300, [17], 0), from: 0 }, 1)).toBe(false);
  });

  it('proposes a pair swap when one exists', () => {
    // P1 holds 5 and 8; P2 holds 6 and 9. Each can complete a pair with the other's tile.
    const s = own(game(2, true), [
      [5, 0],
      [8, 0],
      [6, 1],
      [9, 1],
    ]);
    // P1 gets 9 (₽180, completes C) and gives 5 (₽140, completes B for P2), adding half the ₽40 difference.
    const o = offer(1, [5], 20, [9], 0);
    expect(chooseAction(s)).toEqual(propose(o));
    // The other player accepts it: both complete a pair.
    expect(botAccepts(s, { ...o, from: 0 }, 1)).toBe(true);
    const done = reduce(reduce(s, propose(o)), chooseAction(reduce(s, propose(o))));
    expect(done.lastTrade?.outcome).toBe('accepted');
    expect(done.tiles[9].owner).toBe(0);
    expect(done.tiles[5].owner).toBe(1);
  });

  it('offers a cash buy when no swap exists, keeping its reserve', () => {
    const s = own(game(2, true), [
      [15, 0],
      [17, 1],
    ]);
    const amount = Math.round(260 * CONFIG.bot.trade.cashBuyMultiplier);
    expect(chooseAction(s)).toEqual(propose(offer(1, [], amount, [17], 0)));
    const poor = edit(s, (d) => (d.players[0].cash = amount + CONFIG.bot.trade.cashBuyReserve - 1));
    expect(chooseAction(poor).type).not.toBe('PROPOSE_TRADE');
  });

  it("doesn't repeat a declined offer to the same player for a few rounds", () => {
    const s = own(game(2, true), [
      [15, 0],
      [17, 1],
    ]);
    const first = chooseAction(s);
    expect(first.type).toBe('PROPOSE_TRADE');
    let t = reduce(s, first);
    t = reduce(t, decline);
    // Next turn of the same bot, one round later: no offer.
    const later = edit(t, (d) => {
      d.round += 1;
      d.tradeOffers = 0;
    });
    expect(chooseAction(later).type).not.toBe('PROPOSE_TRADE');
    // After the memory runs out, it may ask again.
    const muchLater = edit(t, (d) => {
      d.round += CONFIG.trade.declineMemoryRounds;
      d.tradeOffers = 0;
    });
    expect(chooseAction(muchLater)).toEqual(first);
  });

  it('same seed and same actions give the same game, trades included', () => {
    const run = () => {
      let s = createGame(
        { players: [0, 1, 2, 3].map((i) => ({ name: `B${i}`, color: '#000', isBot: true, starter: i })), roundLimit: 20, boardMode: 'shuffled' },
        42,
      );
      let trades = 0;
      for (let n = 0; n < 50_000 && s.phase !== 'gameOver'; n++) {
        const a = chooseAction(s);
        if (a.type === 'PROPOSE_TRADE') trades++;
        const next = reduce(s, a);
        expect(next).not.toBe(s);
        s = next;
      }
      return { s, trades };
    };
    const a = run();
    const b = run();
    expect(a.s.phase).toBe('gameOver');
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
    expect(a.trades).toBe(b.trades);
  });
});
