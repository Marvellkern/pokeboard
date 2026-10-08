// Headless bot-vs-bot balance simulator.
// Usage: npm run sim -- [games] [players] [roundLimit] [shuffled|classic]
//   (the board mode can also come from SIM_BOARD=classic; default shuffled, like the setup screen)
// Try config tweaks without editing files (deep-merged into CONFIG):
//   SIM_OVERRIDES='{"goPayout":125,"feeByLevel":{"5":2.8}}' npm run sim

import { CONFIG } from '../data/config';

function deepMerge(target: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(src)) {
    const cur = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object') {
      deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      target[k] = v;
    }
  }
}
if (process.env.SIM_OVERRIDES) {
  deepMerge(CONFIG as unknown as Record<string, unknown>, JSON.parse(process.env.SIM_OVERRIDES));
  console.log(`Overrides: ${process.env.SIM_OVERRIDES}`);
}
import { BALLS, BOARD_TYPES, PAIR_SLOTS, SHOP_BALLS, TYPES, TYPE_CHART, type ThrowBall, type TypeId } from '../data/theme';
import { typeMultiplier } from '../engine/battle';
import { chooseAction } from '../engine/bot';
import { createGame, reduce } from '../engine/reducer';
import { GO_TILE, isProperty, masterBallCost, tileFee, tilePrice } from '../engine/selectors';
import type { BoardMode, GameState } from '../engine/types';

const args = process.argv.slice(2);
const [gamesArg, playersArg, roundsArg] = args.map(Number);
const MODE: BoardMode = (args[3] ?? process.env.SIM_BOARD ?? 'shuffled') === 'classic' ? 'classic' : 'shuffled';
const GAMES = gamesArg || CONFIG.sim.games;
const PLAYERS = playersArg || CONFIG.sim.players;
const ROUND_LIMIT = roundsArg || CONFIG.sim.roundLimit;
const CASH_ROUNDS = [5, 10, 20];
const MAX_STEPS = 50_000;

interface Tally {
  won: number;
  total: number;
}
const tally = (): Tally => ({ won: 0, total: 0 });
const pct = (t: Tally) => (t.total ? `${((100 * t.won) / t.total).toFixed(1)}%` : 'n/a');

const lengths: number[] = [];
let hitLimit = 0;
let withBankruptcy = 0;
const seatWins = new Array(PLAYERS).fill(0);
const feeBattles = tally();
const byMatchup = { advantage: tally(), neutral: tally(), disadvantage: tally() };
const ambush = tally();
let feesPaidOutright = 0;
const cashAt: Record<number, number[]> = Object.fromEntries(CASH_ROUNDS.map((r) => [r, []]));
// Owned creature tiles per (surviving) player at the start of rounds 5 / 10 / 20, and unowned at the end.
const ownedAt: Record<number, number[]> = Object.fromEntries(CASH_ROUNDS.map((r) => [r, []]));
const unownedAtEnd: number[] = [];
// Balls: throws and catches per ball, money spent on throws vs the price of what was caught.
const THROW_BALLS: ThrowBall[] = [...SHOP_BALLS, 'master'];
const throwsBy = Object.fromEntries(THROW_BALLS.map((b) => [b, tally()])) as Record<ThrowBall, Tally>;
let throwSpend = 0;
let caughtPriceSum = 0;
const ballsLeft: number[] = [];
const creatureTiles = (st: GameState) => st.board.map((_, i) => i).filter((i) => isProperty(st, i));
// Pair slots: who first completed each slot (owned both tiles), and who held it at the end.
const slotFirst = PAIR_SLOTS.map(() => tally());
const slotEnd = PAIR_SLOTS.map(() => tally());
// Fees charged to attackers (the amount owed), by the fee tile's type.
const feeByType: Partial<Record<TypeId, number>> = {};
const addFee = (type: TypeId, amount: number) => (feeByType[type] = (feeByType[type] ?? 0) + amount);
// Economy timeline: totals across all games, per round.
const feesByRound: number[] = [];
const goByRound: number[] = [];
const bump = (arr: number[], r: number, v: number) => (arr[r] = (arr[r] ?? 0) + v);
const firstBankruptRounds: number[] = [];
let endedEarly = 0;
let bankruptBefore5 = 0;
const EARLY_ROUNDS = 5;
const feeBattlesEarly = tally();
// Per type (shuffled boards draw 8 of the board types): appearance, pair fee income, completer wins.
interface TypeStats {
  appeared: number;
  pairFees: number;
  completer: Tally;
}
const typeStats = (): TypeStats => ({ appeared: 0, pairFees: 0, completer: tally() });
const byType: Partial<Record<TypeId, TypeStats>> = {};
// For the newest types: the same stats split by whether a counter type had a pair on the board.
const SPLIT_TYPES: TypeId[] = BOARD_TYPES.slice(-3);
const counterSplit: Record<string, { present: TypeStats; absent: TypeStats }> = Object.fromEntries(
  SPLIT_TYPES.map((t) => [t, { present: typeStats(), absent: typeStats() }]),
);
const countersOf = (t: TypeId) => BOARD_TYPES.filter((c) => TYPE_CHART[c].includes(t));
const pairOwner = (st: GameState, k: number): number | null => {
  const [a, b] = PAIR_SLOTS[k].tiles;
  const o = st.tiles[a].owner;
  return o !== null && st.tiles[b].owner === o ? o : null;
};

const started = performance.now();

for (let g = 0; g < GAMES; g++) {
  let s: GameState = createGame(
    {
      players: Array.from({ length: PLAYERS }, (_, i) => ({
        name: `Bot ${i + 1}`,
        color: '#000',
        isBot: true,
        starter: i,
      })),
      roundLimit: ROUND_LIMIT,
      boardMode: MODE,
    },
    g + 1,
  );
  const firstCompleter: (number | null)[] = PAIR_SLOTS.map(() => null);
  const goLine = `passed ${s.board[GO_TILE].name} and collected`;
  let firstBankruptRound: number | null = null;
  const gamePairFees: Partial<Record<TypeId, number>> = {};
  const addPairFee = (st: GameState, tile: number, amount: number) => {
    if (st.board[tile].kind !== 'pokemon') return;
    const t = st.board[tile].type!;
    gamePairFees[t] = (gamePairFees[t] ?? 0) + amount;
  };

  let steps = 0;
  while (s.phase !== 'gameOver') {
    if (++steps > MAX_STEPS) throw new Error(`Game ${g + 1} did not finish in ${MAX_STEPS} steps`);
    const action = chooseAction(s);
    const prev = s;
    s = reduce(s, action);
    if (s === prev) throw new Error(`Bot chose illegal action ${JSON.stringify(action)} in ${prev.phase}`);

    if (prev.phase === 'buy' && action.type === 'THROW') {
      const t = s.lastThrow!;
      throwsBy[t.ball].total++;
      throwSpend += t.ball === 'master' ? masterBallCost(prev, t.tile) : CONFIG.balls.cost[t.ball];
      if (t.caught) {
        throwsBy[t.ball].won++;
        caughtPriceSum += tilePrice(prev, t.tile);
      }
    }
    if (prev.phase === 'feeChoice' && action.type === 'PAY') {
      feesPaidOutright++;
      const fee = tileFee(prev, prev.pendingTile!);
      addFee(prev.board[prev.pendingTile!].type!, fee);
      addPairFee(prev, prev.pendingTile!, fee);
      bump(feesByRound, prev.round, fee);
    }
    // A lost fee battle charges the stake when the result is confirmed.
    if (prev.phase === 'battleOver' && prev.battle!.kind === 'fee' && prev.battle!.winner === 0) {
      addFee(prev.board[prev.battle!.tile!].type!, prev.battle!.stake);
      addPairFee(prev, prev.battle!.tile!, prev.battle!.stake);
      bump(feesByRound, prev.round, prev.battle!.stake);
    }
    // GO income: every new "passed GO" log line this step.
    for (const e of s.log) {
      if (e.id > prev.logSeq && e.text.includes(goLine)) bump(goByRound, prev.round, CONFIG.goPayout);
    }
    if (firstBankruptRound === null && s.bankruptOrder.length > 0) firstBankruptRound = prev.round;
    PAIR_SLOTS.forEach((_, k) => {
      if (firstCompleter[k] === null) firstCompleter[k] = pairOwner(s, k);
    });

    // Battle just ended.
    if (prev.phase === 'battle' && s.phase === 'battleOver') {
      const b = s.battle!;
      const won = b.winner === 1 ? 1 : 0;
      if (b.kind === 'fee') {
        feeBattles.total++;
        feeBattles.won += won;
        if (s.round <= EARLY_ROUNDS) {
          feeBattlesEarly.total++;
          feeBattlesEarly.won += won;
        }
        const m = typeMultiplier(b.sides[1].type, b.sides[0].type);
        const bucket = m > 1 ? byMatchup.advantage : m < 1 ? byMatchup.disadvantage : byMatchup.neutral;
        bucket.total++;
        bucket.won += won;
      } else if (b.kind === 'ambush') {
        ambush.total++;
        ambush.won += won;
      }
    }

    // New round started.
    if (s.round !== prev.round && cashAt[s.round] && s.phase !== 'gameOver') {
      const alive = s.players.filter((p) => !p.bankrupt);
      cashAt[s.round].push(alive.reduce((a, p) => a + p.cash, 0) / alive.length);
      const owned = creatureTiles(s).filter((i) => s.tiles[i].owner !== null).length;
      ownedAt[s.round].push(owned / alive.length);
    }
  }

  const alive = s.players.filter((p) => !p.bankrupt).length;
  lengths.push(s.round);
  {
    const all = creatureTiles(s);
    unownedAtEnd.push(all.filter((i) => s.tiles[i].owner === null).length / all.length);
    for (const pl of s.players) ballsLeft.push(pl.balls.poke + pl.balls.great + pl.balls.ultra);
  }
  if (alive > 1) hitLimit++;
  else endedEarly++;
  if (firstBankruptRound !== null) {
    firstBankruptRounds.push(firstBankruptRound);
    if (firstBankruptRound < EARLY_ROUNDS) bankruptBefore5++;
  }
  if (s.bankruptOrder.length > 0) withBankruptcy++;
  if (s.winner !== null) seatWins[s.winner]++;
  PAIR_SLOTS.forEach((_, k) => {
    const first = firstCompleter[k];
    if (first !== null) {
      slotFirst[k].total++;
      if (first === s.winner) slotFirst[k].won++;
    }
    const end = pairOwner(s, k);
    if (end !== null) {
      slotEnd[k].total++;
      if (end === s.winner) slotEnd[k].won++;
    }
  });
  // Per-type stats for the types that got a pair this game.
  const pairTypes = PAIR_SLOTS.map((slot) => s.board[slot.tiles[0]].type!);
  pairTypes.forEach((t, k) => {
    const targets = [(byType[t] ??= typeStats())];
    if (counterSplit[t]) targets.push(countersOf(t).some((c) => pairTypes.includes(c)) ? counterSplit[t].present : counterSplit[t].absent);
    for (const st of targets) {
      st.appeared++;
      st.pairFees += gamePairFees[t] ?? 0;
      if (firstCompleter[k] !== null) {
        st.completer.total++;
        if (firstCompleter[k] === s.winner) st.completer.won++;
      }
    }
  });
}

const ms = performance.now() - started;
const sorted = [...lengths].sort((a, b) => a - b);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;

const medianOf = (xs: number[]) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};
// GO income comes in waves (everyone starts on GO and laps together, ~every 4 rounds), so compare
// fees and GO over a rolling one-lap window instead of single rounds.
const LAP_ROUNDS = 4;
const windowSum = (arr: number[], r: number) => {
  let t = 0;
  for (let k = r - LAP_ROUNDS + 1; k <= r; k++) t += arr[k] ?? 0;
  return t;
};
const crossRound = (() => {
  for (let r = LAP_ROUNDS; r <= ROUND_LIMIT; r++) if (windowSum(feesByRound, r) > windowSum(goByRound, r)) return r;
  return null;
})();
const p = (n: number) => `${((100 * n) / GAMES).toFixed(1)}%`;

// The balance targets, in one block (also used for the per-step report).
const targets = [
  `── Targets ──`,
  `≥1 bankruptcy:                     ${p(withBankruptcy)}   (≥ 80%)`,
  `Median first-bankruptcy round:     ${firstBankruptRounds.length ? medianOf(firstBankruptRounds) : 'n/a'}   (9-14)`,
  `Ended early (one player left):     ${p(endedEarly)}   (≥ 25%)`,
  `Fees beat GO (per lap) from:      ${crossRound ? `round ${crossRound}` : 'never'}   (by round 8)`,
  `Attacker win rate, all game:       ${pct(feeBattles)}   (40-55%)`,
  `Attacker win rate, rounds 1-${EARLY_ROUNDS}:     ${pct(feeBattlesEarly)}   (≤ 60%)`,
  `Bankruptcy before round ${EARLY_ROUNDS}:         ${p(bankruptBefore5)}   (≤ 5%)`,
  `Win rate by seat:                  ${seatWins.map((w, i) => `P${i + 1} ${p(w)}`).join('  ')}   (each 20-30%)`,
  `Fees/GO per lap (₽k, all games): ${[4, 6, 8, 10, 12, 15, 20]
    .filter((r) => r <= ROUND_LIMIT)
    .map((r) => `R${r} ${Math.round(windowSum(feesByRound, r) / 1000)}/${Math.round(windowSum(goByRound, r) / 1000)}`)
    .join('  ')}`,
  '',
];

const catchStats = [
  `── Catching ──`,
  `Owned tiles per player:            ${CASH_ROUNDS.map((r) => `R${r} ${ownedAt[r].length ? avg(ownedAt[r]).toFixed(2) : 'n/a'}`).join('  ')}`,
  `Creature tiles unowned at end:     ${(100 * avg(unownedAtEnd)).toFixed(1)}%   (≤ 15%)`,
  `Throws (success rate):             ${THROW_BALLS.map((b) => `${BALLS[b].name} ${throwsBy[b].total} (${pct(throwsBy[b])})`).join('  ')}`,
  `Share of catches:                  ${(() => {
    const total = THROW_BALLS.reduce((a, b) => a + throwsBy[b].won, 0) || 1;
    const shop = SHOP_BALLS.reduce((a, b) => a + throwsBy[b].won, 0);
    return `${THROW_BALLS.map((b) => `${BALLS[b].name} ${((100 * throwsBy[b].won) / total).toFixed(1)}%`).join('  ')}   · non-Master ${((100 * shop) / total).toFixed(1)}% (30-70%)`;
  })()}`,
  `Spent per catch (% of tile price): ${caughtPriceSum ? ((100 * throwSpend) / caughtPriceSum).toFixed(1) : 'n/a'}%   (misses included)`,
  `Balls left unused per player:      ${avg(ballsLeft).toFixed(2)}`,
  '',
];

const lines = [
  ...targets,
  ...catchStats,
  `Simulated ${GAMES} games · ${PLAYERS} bots · round limit ${ROUND_LIMIT} · ${MODE} board · ${(ms / 1000).toFixed(1)}s`,
  '',
  `Game length (rounds):   avg ${avg(lengths).toFixed(1)}, median ${median}`,
  `Hit round limit:        ${((100 * hitLimit) / GAMES).toFixed(1)}%`,
  `≥1 bankruptcy:          ${((100 * withBankruptcy) / GAMES).toFixed(1)}%`,
  `Win rate by seat:       ${seatWins.map((w, i) => `P${i + 1} ${((100 * w) / GAMES).toFixed(1)}%`).join('  ')}`,
  '',
  `Fee battles:            ${feeBattles.total} (${(feeBattles.total / GAMES).toFixed(1)}/game), paid outright ${feesPaidOutright}`,
  `Attacker win rate:      ${pct(feeBattles)}   (target 40-55%)`,
  `  with type advantage:  ${pct(byMatchup.advantage)}  (n=${byMatchup.advantage.total})`,
  `  neutral:              ${pct(byMatchup.neutral)}  (n=${byMatchup.neutral.total})`,
  `  with disadvantage:    ${pct(byMatchup.disadvantage)}  (n=${byMatchup.disadvantage.total})`,
  `Ambush win rate:        ${pct(ambush)}  (n=${ambush.total})`,
  '',
  `Avg cash per player:    ${CASH_ROUNDS.map((r) => `R${r} ${cashAt[r].length ? Math.round(avg(cashAt[r])) : 'n/a'}`).join('  ')}`,
];
lines.push(
  '',
  `Pair slots (win rate of the player who completed it; a fair share is ${(100 / PLAYERS).toFixed(0)}%):`,
  '  slot  price  completed  first completer wins  owner at end wins',
  ...PAIR_SLOTS.map((slot, k) => {
    const price = String(CONFIG.propertyPrices[slot.tiles[0]]).padStart(3);
    const done = `${((100 * slotFirst[k].total) / GAMES).toFixed(0)}%`.padStart(6);
    return `  ${slot.id}     ${price}   ${done}     ${pct(slotFirst[k]).padStart(6)}                ${pct(slotEnd[k]).padStart(6)}`;
  }),
);
const feeEntries = (Object.entries(feeByType) as [TypeId, number][]).sort((a, b) => b[1] - a[1]);
const feeTotal = feeEntries.reduce((a, [, v]) => a + v, 0);
const feeMean = feeTotal / (feeEntries.length || 1);
lines.push(
  '',
  'Fee income by type (fees charged, avg per game, share of all fees):',
  ...feeEntries.map(
    ([type, v]) =>
      `  ${TYPES[type].name.padEnd(9)} ${String(Math.round(v / GAMES)).padStart(5)}  ${((100 * v) / feeTotal).toFixed(1).padStart(5)}%`,
  ),
);
const typeRow = (label: string, st: TypeStats) =>
  `  ${label.padEnd(22)} ${String(st.appeared).padStart(5)}  ${String(st.appeared ? Math.round(st.pairFees / st.appeared) : 0).padStart(7)}   ${pct(st.completer).padStart(6)} (n=${st.completer.total})`;
lines.push(
  '',
  `Per type (pair tiles only; fee = avg per game where the type had a pair; fair completer share ${(100 / PLAYERS).toFixed(0)}%):`,
  `  type                   games   ₽/game   completer wins`,
  ...BOARD_TYPES.filter((t) => byType[t]).map((t) => {
    const st = byType[t]!;
    return `${typeRow(TYPES[t].name, st)}   appears ${((100 * st.appeared) / GAMES).toFixed(1)}%`;
  }),
);
if (MODE === 'shuffled') {
  lines.push('', 'Counter present on the board (a type that beats it has a pair) vs not:');
  for (const t of SPLIT_TYPES) {
    const names = countersOf(t).map((c) => TYPES[c].name).join('/');
    lines.push(typeRow(`${TYPES[t].name}, ${names} present`, counterSplit[t].present), typeRow(`${TYPES[t].name}, no ${names}`, counterSplit[t].absent));
  }
}
console.log(lines.join('\n'));

const fbRate = feeBattles.total ? feeBattles.won / feeBattles.total : 0;
const warnings: string[] = [];
if (fbRate < 0.4 || fbRate > 0.55) warnings.push(`Attacker win rate ${pct(feeBattles)} is outside 40-55%.`);
if (MODE === 'shuffled') {
  for (const [type, v] of feeEntries) {
    if (v > feeMean * 1.3 || v < feeMean * 0.7) {
      warnings.push(`${TYPES[type].name} earns ${((100 * v) / feeTotal).toFixed(1)}% of all fees (over 30% off the average type).`);
    }
  }
}
if (hitLimit / GAMES > 0.7) warnings.push(`${((100 * hitLimit) / GAMES).toFixed(0)}% of games hit the round limit (>70%).`);
if (warnings.length) console.log(`\n⚠ ${warnings.join('\n⚠ ')}`);
