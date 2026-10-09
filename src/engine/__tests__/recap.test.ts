import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../data/config';
import { migrateSave } from '../board';
import { chooseAction } from '../bot';
import { packEvents, unpackEvents } from '../eventCodec';
import { chartPoints, comeback, eventDelta, keyMoments, standings, winMargin } from '../recap';
import { createGame, reduce } from '../reducer';
import { netWorth } from '../selectors';
import type { GameEvent, GameEventType, GameState } from '../types';

function botGame(seed: number, players = 4, boardMode: 'classic' | 'shuffled' = 'shuffled'): GameState {
  let s = createGame(
    { players: Array.from({ length: players }, (_, i) => ({ name: `Bot ${i + 1}`, color: '#000', isBot: true, starter: i })), roundLimit: 20, boardMode },
    seed,
  );
  for (let n = 0; n < 50_000 && s.phase !== 'gameOver'; n++) s = reduce(s, chooseAction(s));
  return s;
}

/** A finished 2-player game whose net-worth story is given directly: one [p0, p1] pair per event. */
function story(worths: [number, number][], winner: 0 | 1, extra: Partial<GameEvent>[] = []): GameState {
  const s = createGame({ players: [0, 1].map((i) => ({ name: `P${i + 1}`, color: '#000', isBot: true, starter: i })), roundLimit: 20 }, 1);
  const events: GameEvent[] = worths.map((w, k) => ({
    id: k + 1,
    turn: k + 1,
    round: Math.floor(k / 2) + 1,
    player: k % 2,
    type: (k === 0 ? 'start' : 'payment') as GameEventType,
    text: `event ${k + 1}`,
    cash: [...w],
    worth: [...w],
    ...extra[k],
  }));
  return { ...s, events, winner, phase: 'gameOver' };
}

const START = CONFIG.startingMoney;
const BIG = CONFIG.recap.comebackShare * START;

describe('event log', () => {
  const games = [1, 2, 3, 4, 5, 6].map((seed) => botGame(seed, 4, seed % 2 ? 'shuffled' : 'classic'));

  it('is ordered, starts with start, ends with game_over, and its last snapshot is the final money', () => {
    for (const s of games) {
      expect(s.events.map((e) => e.id)).toEqual(s.events.map((_, k) => k + 1));
      expect(s.events[0].type).toBe('start');
      expect(s.events.at(-1)!.type).toBe('game_over');
      expect(s.events.at(-1)!.player).toBe(s.winner);
      const last = s.events.at(-1)!;
      expect(last.cash).toEqual(s.players.map((p) => p.cash));
      expect(last.worth).toEqual(s.players.map((_, i) => netWorth(s, i)));
      // Turns and rounds never go backwards.
      s.events.forEach((e, k) => k > 0 && expect(e.turn).toBeGreaterThanOrEqual(s.events[k - 1].turn));
    }
  });

  it('covers every kind of event the game has', () => {
    const seen = new Set(games.flatMap((s) => s.events.map((e) => e.type)));
    const many = new Set([...seen, ...[7, 8, 9, 10, 11, 12, 13, 14].flatMap((seed) => botGame(seed).events.map((e) => e.type))]);
    for (const t of ['start', 'roll', 'move', 'card', 'ball_purchase', 'catch_success', 'catch_fail', 'battle_won', 'battle_lost', 'payment', 'money_gain', 'level_up', 'trade', 'game_over'] as GameEventType[]) {
      expect(many.has(t), t).toBe(true);
    }
  });

  it('every cash change is inside an event (deltas add up to the final cash)', () => {
    for (const s of games) {
      const total = s.players.map((_, i) => s.events.reduce((sum, _e, k) => sum + eventDelta(s.events, k)[i], s.events[0].cash[i]));
      expect(total).toEqual(s.players.map((p) => p.cash));
    }
  });

  it('packs small for the network and unpacks to the same log', () => {
    const s = games[0];
    const packed = JSON.stringify(packEvents(s.events));
    expect(unpackEvents(JSON.parse(packed), s.players.length)).toEqual(s.events);
    expect(packed.length).toBeLessThan(JSON.stringify(s.events).length * 0.7);
  });

  it("doesn't change the game: same seed, same actions, same result as without reading it", () => {
    const a = botGame(21);
    const b = botGame(21);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('old saves start their log at load time', () => {
    const old = { ...botGame(3) } as Partial<GameState>;
    delete old.events;
    const s = migrateSave(old as GameState);
    expect(s.events).toHaveLength(1);
    expect(s.events[0].type).toBe('start');
    expect(s.events[0].cash).toEqual(s.players.map((p) => p.cash));
  });
});

describe('recap', () => {
  it('standings follow the final ranking and count battles for both sides', () => {
    const s = botGame(4);
    const st = standings(s);
    expect(st[0].pid).toBe(s.winner);
    expect(st.map((x) => x.rank)).toEqual(st.map((_, k) => k + 1));
    const won = st.reduce((a, x) => a + x.battles.won, 0);
    const fights = s.events.filter((e) => e.type === 'battle_won' || e.type === 'battle_lost');
    const pvp = fights.filter((e) => e.meta?.opponent !== null && e.meta?.opponent !== undefined).length;
    expect(won + st.reduce((a, x) => a + x.battles.lost, 0)).toBe(fights.length + pvp);
  });

  it('the margin is the net-worth gap to second place', () => {
    const s = botGame(5);
    const m = winMargin(s)!;
    expect(m.winner).toBe(s.winner);
    if (!m.lastStanding) expect(m.margin).toBe(netWorth(s, m.winner) - netWorth(s, m.runnerUp!));
  });

  it('the chart ends on each player final value', () => {
    const s = botGame(6);
    const pts = chartPoints(s.events, 'worth');
    expect(pts.at(-1)!.values).toEqual(s.players.map((_, i) => netWorth(s, i)));
    expect(pts[0].values).toEqual(s.players.map(() => START));
  });

  it('finds a comeback: behind by a lot, then ahead to the end', () => {
    const s = story(
      [
        [START, START],
        [START, START + BIG + 100], // P1 far behind
        [START + 50, START + BIG],
        [START + BIG + 500, START + BIG], // P1 takes the lead for good
        [START + BIG + 600, START + BIG],
      ],
      0,
    );
    const c = comeback(s)!;
    expect(c.eventId).toBe(4);
    expect(c.text).toContain(`₽${(BIG + 100).toLocaleString('en-US')} behind`);
  });

  it('no comeback when the winner led all along, or was only a little behind', () => {
    const ledAll = story(
      [
        [START, START],
        [START + 100, START],
        [START + 300, START + 200],
      ],
      0,
    );
    expect(comeback(ledAll)).toBeNull();
    const smallGap = story(
      [
        [START, START],
        [START, START + BIG - 1],
        [START + BIG, START + BIG - 1],
      ],
      0,
    );
    expect(comeback(smallGap)).toBeNull();
    expect(keyMoments(smallGap).some((m) => m.kind === 'comeback')).toBe(false);
  });

  it('no comeback if the lead changed back at the end', () => {
    const s = story(
      [
        [START, START],
        [START, START + 1000],
        [START + 2000, START + 1000],
        [START + 900, START + 1000], // behind again at the end, but declared winner anyway (e.g. a tie-break)
      ],
      0,
    );
    expect(comeback(s)).toBeNull();
  });

  it('the luckiest catch needs low odds with a carried ball; battle star needs a clear leader', () => {
    const base: [number, number][] = [
      [START, START],
      [START, START],
      [START, START],
    ];
    const lucky = story(base, 0, [{}, { type: 'catch_success', meta: { ball: 'poke', chance: 0.3 } }, { type: 'catch_success', meta: { ball: 'master', chance: 1 } }]);
    expect(keyMoments(lucky).find((m) => m.kind === 'luckyCatch')?.eventId).toBe(2);
    const easy = story(base, 0, [{}, { type: 'catch_success', meta: { ball: 'ultra', chance: 0.9 } }]);
    expect(keyMoments(easy).some((m) => m.kind === 'luckyCatch')).toBe(false);
    // No money moved and no battles: nothing to highlight at all.
    expect(keyMoments(story(base, 0))).toEqual([]);
  });
});
