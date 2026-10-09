import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../data/config';
import { migrateSave } from '../board';
import { botAnswer, chooseAction } from '../bot';
import { createGame, reduce } from '../reducer';
import { counterCheck, isLegal, legalActions, tradeCheck } from '../selectors';
import { tradeChanges } from '../trade';
import type { Action, GameState, PlayerId, TradeOffer, TradeSide } from '../types';

// Classic board: pair slots A [1,3], B [5,6], C [8,9], D [12,13], E [15,17], F [19,20], G [22,23], H [26,27].

function game(bots = false): GameState {
  return createGame({ players: [0, 1].map((i) => ({ name: ['Rina', 'Budi'][i], color: '#000', isBot: bots, starter: i })), roundLimit: 20 }, 3);
}
const edit = (s: GameState, fn: (d: GameState) => void) => {
  const d = structuredClone(s);
  fn(d);
  return d;
};
const own = (s: GameState, list: [number, PlayerId, number?][]) =>
  edit(s, (d) => {
    for (const [i, owner, level] of list) d.tiles[i] = { owner, level: level ?? 1 };
  });
function act(s: GameState, a: Action): GameState {
  expect(isLegal(s, a), `illegal ${JSON.stringify(a)} in ${s.phase}`).toBe(true);
  return reduce(s, a);
}
const side = (tiles: number[], money: number): TradeSide => ({ tiles, money });
const offer = (give: TradeSide, receive: TradeSide): TradeOffer => ({ to: 1, give, receive });
const propose = (o: TradeOffer): Action => ({ type: 'PROPOSE_TRADE', ...o });
const counter = (give: TradeSide, receive: TradeSide, by?: PlayerId): Action => ({ type: 'COUNTER_TRADE', give, receive, ...(by !== undefined ? { by } : {}) });
const accept: Action = { type: 'RESPOND_TRADE', accept: true };
const decline: Action = { type: 'RESPOND_TRADE', accept: false };
const START = CONFIG.startingMoney;

/** Rina (0) owns 1 and 5; Budi (1) owns 8 and 9. Rina offers 1 for 8. */
const opened = () => act(own(game(), [[1, 0], [5, 0], [8, 1], [9, 1]]), propose(offer(side([1], 0), side([8], 0))));

describe('counter-offers: engine', () => {
  it('a counter replaces the pending proposal and hands the answer back', () => {
    // Budi (answering) counters from his side: he gives 8 and wants 1 plus ₽60.
    const s = act(opened(), counter(side([8], 0), side([1], 60), 1));
    const t = s.pendingTrade!;
    expect(s.phase).toBe('trade');
    expect(t.answerer).toBe(0);
    // Stored from Rina's side: she now gives 1 + ₽60 and still gets 8.
    expect(t.give).toEqual(side([1], 60));
    expect(t.receive).toEqual(side([8], 0));
    expect(t.history).toEqual([offer(side([1], 0), side([8], 0))]);
    expect(s.log.at(-1)!.text).toBe("Budi countered Rina's offer.");
    expect(s.events.at(-1)!.type).toBe('trade_counter');
  });

  it('accepting after a counter executes the newest terms', () => {
    let s = act(opened(), counter(side([8], 0), side([1], 60)));
    s = act(s, { ...accept, by: 0 });
    expect(s.tiles[1].owner).toBe(1);
    expect(s.tiles[8].owner).toBe(0);
    expect(s.players[0].cash).toBe(START - 60);
    expect(s.players[1].cash).toBe(START + 60);
    expect(s.log.at(-1)!.text).toContain('Rina accepted the counter:');
    expect(s.lastTrade).toMatchObject({ outcome: 'accepted', proposals: 2, answeredBy: 0 });
  });

  it('declining a counter moves nothing', () => {
    let s = act(opened(), counter(side([8], 0), side([1], 60)));
    s = act(s, decline);
    expect(s.tiles[1].owner).toBe(0);
    expect(s.players[0].cash).toBe(START);
    expect(s.log.at(-1)!.text).toBe('Rina declined the counter.');
    expect(s.phase).toBe('roll');
  });

  it('at most 3 proposals: the final answer is accept or decline only', () => {
    let s = act(opened(), counter(side([8], 0), side([1], 60))); // 2: Budi
    s = act(s, counter(side([1], 30), side([8], 0))); // 3: Rina meets in the middle
    expect(s.pendingTrade!.answerer).toBe(1);
    expect(s.pendingTrade!.history).toHaveLength(CONFIG.trade.maxProposals - 1);
    expect(counterCheck(s, { give: side([8], 0), receive: side([1], 40) }).reason).toBe('final');
    expect(legalActions(s)).toEqual([accept, decline]);
    s = act(s, accept);
    expect(s.players[1].cash).toBe(START + 30);
    expect(s.lastTrade?.proposals).toBe(3);
  });

  it('an identical counter is rejected (that would just be Accept)', () => {
    const s = opened();
    expect(counterCheck(s, { give: side([8], 0), receive: side([1], 0) }).reason).toBe('same');
    expect(isLegal(s, counter(side([8], 0), side([1], 0)))).toBe(false);
  });

  it('a counter follows every trade rule', () => {
    const s = opened();
    expect(counterCheck(s, { give: side([8], START + 1), receive: side([1], 0) }).reason).toBe('money'); // more than Budi has
    expect(counterCheck(s, { give: side([8], 0), receive: side([1], START + 1) }).reason).toBe('money'); // more than Rina has
    expect(counterCheck(s, { give: side([5], 0), receive: side([1], 0) }).reason).toBe('tiles'); // 5 is Rina's
    expect(counterCheck(s, { give: side([], 0), receive: side([1], 0) }).reason).toBe('empty');
    const withBall = { give: { tiles: [8], money: 0, balls: 1 }, receive: side([1], 0) } as unknown as { give: TradeSide; receive: TradeSide };
    expect(counterCheck(s, withBall).ok).toBe(false);
    expect(counterCheck(s, { give: side([8, 9], 0), receive: side([1, 5], 0) }).ok).toBe(true);
  });

  it('only the current answerer can act; nothing else is legal while it is open', () => {
    let s = opened();
    expect(isLegal(s, counter(side([1], 0), side([8], 10), 0))).toBe(false); // Rina can't counter her own offer
    s = act(s, counter(side([8], 0), side([1], 60), 1));
    expect(isLegal(s, { ...accept, by: 1 })).toBe(false);
    expect(isLegal(s, { ...accept, by: 0 })).toBe(true);
    for (const a of [{ type: 'ROLL' }, { type: 'END_TURN' }, { type: 'BUY_BALL', ball: 'poke' }] as Action[]) expect(isLegal(s, a)).toBe(false);
    expect(isLegal(s, propose(offer(side([5], 0), side([9], 0))))).toBe(false);
  });

  it('the whole chain is the turn player’s one offer', () => {
    let s = act(opened(), counter(side([8], 0), side([1], 60)));
    s = act(s, decline);
    expect(s.tradeOffers).toBe(1);
    expect(tradeCheck(s, offer(side([5], 0), side([9], 0))).reason).toBe('used');
  });

  it('a counter is checked again at acceptance', () => {
    let s = act(opened(), counter(side([8], 0), side([1], 60)));
    s = edit(s, (d) => (d.players[0].cash = 10)); // Rina can no longer pay the ₽60
    s = act(s, accept);
    expect(s.lastTrade?.outcome).toBe('cancelled');
    expect(s.tiles[8].owner).toBe(1);
  });

  it('a decline at any step is remembered as the opening offer (no-spam rule)', () => {
    let s = act(opened(), counter(side([8], 0), side([1], 60)));
    s = act(s, decline);
    expect(s.tradeDeclines.at(-1)).toMatchObject({ from: 0, to: 1, give: side([1], 0), receive: side([8], 0) });
  });

  it('tradeChanges lists what was added, removed and re-priced', () => {
    const before = { give: side([1], 0), receive: side([8], 100) };
    const after = { give: side([1, 5], 60), receive: side([], 40) };
    expect(tradeChanges(before, after)).toEqual([
      { kind: 'added', side: 'give', tile: 5 },
      { kind: 'money', side: 'give', before: 0, after: 60 },
      { kind: 'removed', side: 'receive', tile: 8 },
      { kind: 'money', side: 'receive', before: 100, after: 40 },
    ]);
  });

  it('a pending trade saved before counters is proposal 1, answered by its recipient', () => {
    const s = opened();
    const old = edit(s, (d) => {
      const t = d.pendingTrade as Partial<NonNullable<GameState['pendingTrade']>>;
      delete t.answerer;
      delete t.history;
    });
    const m = migrateSave(old);
    expect(m.pendingTrade!.answerer).toBe(1);
    expect(m.pendingTrade!.history).toEqual([]);
    expect(isLegal(m, counter(side([8], 0), side([1], 60), 1))).toBe(true);
  });
});

describe('counter-offers: bots', () => {
  /** Budi (bot) owns 26 (₽400, Lv 1, no pair). Rina offers cash for it. */
  const cashFor26 = (amount: number, rinaCash = START) =>
    act(
      edit(own(game(true), [[26, 1]]), (d) => (d.players[0].cash = rinaCash)),
      propose(offer(side([], amount), side([26], 0))),
    );

  it('counters a near miss, asking for the gap in cash (rounded up to ₽10)', () => {
    const needed = 400 * CONFIG.bot.trade.acceptRatio;
    const s = cashFor26(355);
    const ask = Math.ceil((needed - 355) / 10) * 10;
    expect(botAnswer(s)).toEqual({ type: 'COUNTER_TRADE', give: side([26], 0), receive: side([], 355 + ask) });
  });

  it('pays less first when it was already paying cash', () => {
    // Rina gives 8 (₽180); Budi would give 5 (₽140) + ₽50. Budi needs 190, gets 180: gap ₽10.
    const s = act(own(game(true), [[8, 0], [5, 1]]), propose(offer(side([8], 0), side([5], 50))));
    expect(botAnswer(s)).toEqual({ type: 'COUNTER_TRADE', give: side([5], 40), receive: side([8], 0) });
  });

  it('declines a far miss', () => {
    expect(botAnswer(cashFor26(10))).toEqual(decline);
  });

  it("respects the other player's cash", () => {
    expect(botAnswer(cashFor26(355, 380))).toEqual(decline);
  });

  it('accepts a good counter, and never counters a counter', () => {
    // Bot Rina (0) holds 15; human-ish Budi (1) holds 17 (₽260). Rina's cash buy is 2 × 260.
    const base = own(game(true), [[15, 0], [17, 1]]);
    const opening = chooseAction(base);
    expect(opening).toEqual(propose(offer(side([], 520), side([17], 0))));
    const open = reduce(base, opening);
    // A cheaper counter is better for the bot: accept.
    const cheaper = act(open, counter(side([17], 0), side([], 400), 1));
    expect(botAnswer(cheaper)).toEqual(accept);
    // A pricier counter that's only a little off: the bot declines rather than countering back.
    const near = act(open, counter(side([17], 0), side([], 440), 1));
    expect(botAnswer(near)).toEqual(decline);
  });

  it('bot-vs-bot negotiations end by proposal 2, and games stay deterministic', () => {
    const run = () => {
      let s = createGame({ players: [0, 1, 2, 3].map((i) => ({ name: `B${i}`, color: '#000', isBot: true, starter: i })), roundLimit: 20, boardMode: 'shuffled' }, 77);
      let counters = 0;
      let longest = 0;
      while (s.phase !== 'gameOver') {
        const a = chooseAction(s);
        if (a.type === 'COUNTER_TRADE') counters++;
        s = reduce(s, a);
        if (s.pendingTrade) longest = Math.max(longest, s.pendingTrade.history.length + 1);
      }
      return { json: JSON.stringify(s), counters, longest };
    };
    const a = run();
    const b = run();
    expect(a.json).toBe(b.json);
    expect(a.longest).toBeLessThanOrEqual(2);
  });
});
