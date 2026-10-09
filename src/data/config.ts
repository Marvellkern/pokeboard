// ─────────────────────────────────────────────────────────────────────────────
// CONFIG: every tunable gameplay number. Change values here, then `npm run sim`.
// Names/text live in theme.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { CardEffect } from '../engine/types';

export const CONFIG = {
  // ── Setup ──
  minPlayers: 2,
  maxPlayers: 4,
  /** Cash each player starts with. */
  startingMoney: 1500,
  /** Round-limit options on the setup screen, and the default. */
  roundLimits: [10, 20, 30],
  defaultRoundLimit: 20,

  // ── Movement ──
  /** Number of dice rolled and their sides. */
  dice: { count: 2, sides: 6 },
  /** Paid when passing or landing on the start tile (also the Fly card). Was ₽200 (sized for 40 tiles); sim-tuned to the bottom of the ₽100-175 range. */
  goPayout: 100,
  /** Collected on the bonus tile. */
  bonusTilePayout: 50,

  // ── Properties ──
  /** Purchase price per board tile index (regular creatures). */
  propertyPrices: {
    1: 100, 3: 100,
    5: 140, 6: 140,
    8: 180, 9: 180,
    12: 220, 13: 220,
    15: 260, 17: 260,
    19: 300, 20: 300,
    22: 350, 23: 350,
    26: 400, 27: 400,
  } as Record<number, number>,
  /**
   * Fee = round(price × feeByLevel[level]). Steep and convex so leveling pays off;
   * levels 3-5 need the full pair. Levels 3-5 are at the top of the brief's tuning range
   * (sim-tuned; brief start was 1.0 / 1.75 / 2.5). Was a flat price × 0.2 × level.
   */
  feeByLevel: { 1: 0.2, 2: 0.5, 3: 1.2, 4: 2.1, 5: 3.0 } as Record<number, number>,
  /** Each level-up costs round(price × levelCostRatio). */
  levelCostRatio: 0.5,
  /** Level a freshly caught creature starts at. */
  startLevel: 1,
  /** Highest level for tile creatures. */
  maxLevel: 5,
  /** Without owning both of a type pair, a creature can't go above this level. */
  setRuleCap: 2,
  /** Levels at which a creature evolves to its next stage (stage 2, stage 3). */
  evolutionLevels: [3, 5],

  // ── Legendaries ──
  legendary: {
    price: 200,
    /** Legendaries can't level; they always fight at this level. */
    battleLevel: 3,
    /** Fee by how many legendaries the owner holds (doubles each time). (Was ₽50 per legendary.) */
    feeByCount: { 1: 50, 2: 100, 3: 200, 4: 400 } as Record<number, number>,
  },

  // ── Balls (names and colors in theme.ts) ──
  balls: {
    /** Shop price of each carried ball. */
    cost: { poke: 50, great: 100, ultra: 200 } as Record<'poke' | 'great' | 'ultra', number>,
    /**
     * Catch power = cost × powerMultiplier. Brief start 1.2 (60 / 120 / 240); sim-tuned to 1.4
     * (70 / 140 / 280), the lowest value where non-Master catches reach 30%+. Tuning range 1.2-1.5.
     */
    powerMultiplier: 1.4,
    /** Catch chance = min(maxChance, power / tile price); the Master Ball always catches. */
    maxChance: 0.95,
    /** Legendary tiles: chance × this (they should feel hard to catch). */
    legendaryMultiplier: 0.5,
    /** Most balls a player can carry in total (any mix). Tuning range 3-4. */
    carryLimit: 3,
    /** Balls every player starts a new game with. Tuning range 1-3 in total. */
    starting: { poke: 2, great: 0, ultra: 0 } as Record<'poke' | 'great' | 'ultra', number>,
  },

  // ── Starters ──
  starter: {
    /** Cost per starter level-up. Was ₽100. */
    levelCost: 150,
    /** Starters stop at the unpaired-tile cap so they can't out-level defenders. Was 3. Old saves keep a Lv 3 starter. */
    maxLevel: 2,
  },

  // ── Battles ──
  /** Max HP = base + perLevel × level. */
  hp: { base: 20, perLevel: 5 },
  /** Basic (untyped) attack damage = base + perLevel × level + random(0..damageVariance). Ignores types. */
  tackle: { base: 6, perLevel: 2 },
  /** Type move damage = (base + perLevel × level) × typeMultiplier + random(0..damageVariance). */
  typeMove: { base: 8, perLevel: 2 },
  damageVariance: 2,
  /** Every hit deals at least this much. */
  minDamage: 1,
  typeMultipliers: { strong: 1.5, weak: 0.5, neutral: 1 },
  protect: {
    /** Multiplier on the next hit taken while protecting. */
    damageTakenMultiplier: 0.5,
    /** Multiplier on the attack right after using the guard move. */
    nextAttackMultiplier: 1.5,
  },
  /** After this many total moves the higher HP % wins (ties → defender). */
  battleMoveCap: 12,
  /**
   * Battling and losing costs round(fee × (1 + this)); paying without a battle costs the plain fee.
   * Applies to fee battles and the ambush tile. 0 turns the rule off.
   * Off: in the sim 0.25 and 0.5 did not move any balance target (bankruptcies unchanged); it only made
   * bots skip battles they would lose. The rule stays in place so it can be switched back on.
   */
  battleLossSurcharge: 0,

  // ── Grunts (ambush tile and hideout guard) ──
  grunt: {
    /** Grunt level = min(maxLevel, ceil(round / roundsPerLevel)). */
    maxLevel: 4,
    roundsPerLevel: 5,
  },
  /** Paid to the bank when losing (or skipping) an ambush battle. */
  ambushFee: 100,
  hideout: {
    /** Paid to leave the hideout. */
    fee: 50,
    /** After this many lost guard battles, the fee is paid automatically and you move. */
    maxFailedTurns: 3,
  },

  // ── Trading ──
  trade: {
    /** Offers a player may make per turn (accepted or not). */
    offersPerTurn: 1,
    /** Online: an offer nobody answers in this many seconds (or whose recipient is offline) is declined. */
    responseSeconds: 30,
    /** A declined offer is remembered this many rounds; bots don't repeat it to the same player meanwhile. */
    declineMemoryRounds: 3,
  },

  // ── Debt ──
  /** Releasing a creature refunds this share of everything invested (price + levels). Was 0.5. */
  liquidationRatio: 0.4,

  // ── Cards (text in theme.CARD_TEXT, same order) ──
  cards: [
    { kind: 'gain', amount: 100 },
    { kind: 'gain', amount: 150 },
    { kind: 'gain', amount: 50 },
    { kind: 'lose', amount: 50 },
    { kind: 'lose', amount: 75 },
    { kind: 'rareCandy', fallback: 50 },
    { kind: 'advanceToGo' },
    { kind: 'move', steps: 3 },
    { kind: 'move', steps: -3 },
    { kind: 'goToHideout' },
    { kind: 'escapeRope' },
    { kind: 'birthday', amount: 25 },
    /** Gain a ball; with a full bag, gain the fallback cash instead. */
    { kind: 'gainBall', ball: 'great', fallback: 50 },
    { kind: 'gainBall', ball: 'ultra', fallback: 100 },
  ] as CardEffect[],

  // ── Bots ──
  bot: {
    /** Keep leveling while cash is above this. */
    levelReserve: 500,
    /** Chance to use the guard move when own HP ratio is above protectHpRatio. */
    protectChance: 0.15,
    protectHpRatio: 0.6,
    /** Shop: with fewer than this many balls, buy one (at most one purchase per turn). */
    shopBelowBalls: 2,
    /** Shop: buy a Great Ball at this cash or more, else a Poké Ball at shopPokeCash or more. */
    shopGreatCash: 600,
    shopPokeCash: 300,
    /** Throw a carried ball when its catch chance is at least this (cheapest such ball). */
    goodThrowChance: 0.5,
    /** Master Ball if it completes a pair and leaves at least this much cash. */
    masterPairReserve: 100,
    /** Otherwise Master Ball only if it leaves at least this much cash. */
    masterReserve: 300,
    /**
     * Estimated chance the attacking bot wins, by its fighter's type matchup and level difference
     * (attacker − defender, clamped to ±4). Measured bot-vs-bot with the real battle engine.
     * Bots battle when winChance × fee > (1 − winChance) × fee × battleLossSurcharge.
     */
    winChance: {
      advantage: { [-4]: 0, [-3]: 0, [-2]: 0.1, [-1]: 0.85, 0: 0.99, 1: 1, 2: 1, 3: 1, 4: 1 },
      neutral: { [-4]: 0, [-3]: 0, [-2]: 0, [-1]: 0, 0: 0.02, 1: 0.6, 2: 1, 3: 1, 4: 1 },
      disadvantage: { [-4]: 0, [-3]: 0, [-2]: 0, [-1]: 0, 0: 0, 1: 0.02, 2: 0.5, 3: 0.9, 4: 1 },
    } as Record<'advantage' | 'neutral' | 'disadvantage', Record<number, number>>,
    /** Trading (bots value tiles at their price, adjusted as below; money at face value). */
    trade: {
      /** A tile that would complete (or, given away, breaks) the bot's own pair is worth price × this. */
      pairMultiplier: 1.6,
      /** A legendary is worth legendary price × (1 + this × legendaries held afterwards). */
      legendaryStep: 0.25,
      /** Giving away a tile that completes the other player's pair costs an extra price × this (unless the bot completes one too). */
      dangerPremium: 0.5,
      /** Accept when value received ≥ value given × this. Brief start 1.1; sim-tuned to 1.0 (range 1.0-1.25). */
      acceptRatio: 1.0,
      /**
       * Cash-buy offers pay tile price × this... Brief start 1.5; sim-tuned to 2 (range 1.5-2). A seller values a
       * Lv 2 tile at price + danger premium + levels = 2× price, so below 2 only Lv 1 tiles ever sell.
       */
      cashBuyMultiplier: 2,
      /** ...and only if the bot keeps at least this much cash. */
      cashBuyReserve: 300,
    },
  },

  // ── Misc ──
  /** How many log entries are kept. */
  logSize: 50,

  // ── UI timing (ms) ──
  ui: {
    botStepDelay: 800,
    hopPerTile: 120,
    diceShake: 400,
    hpTween: 300,
    hitFlash: 150,
    botBattleBanner: 2000,
  },

  // ── Simulator defaults ──
  sim: { games: 1000, players: 4, roundLimit: 30 },
};
