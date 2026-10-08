// Battle rules. Pure functions over Battle objects; randomness via RngHolder.

import { CONFIG } from '../data/config';
import { MOVES, TYPES, TYPE_CHART, NEUTRAL_TYPE, type TypeId } from '../data/theme';
import { nextInt, type RngHolder } from './rng';
import type { Battle, Combatant, MoveKind, PlayerId, Side } from './types';

export function typeMultiplier(attacker: TypeId, defender: TypeId): number {
  const m = CONFIG.typeMultipliers;
  if (attacker === NEUTRAL_TYPE || defender === NEUTRAL_TYPE) return m.neutral;
  if (TYPE_CHART[attacker].includes(defender)) return m.strong;
  if (TYPE_CHART[defender].includes(attacker)) return m.weak;
  return m.neutral;
}

export function maxHpFor(level: number): number {
  return CONFIG.hp.base + CONFIG.hp.perLevel * level;
}

export function makeCombatant(
  owner: PlayerId | null,
  tile: number | null,
  name: string,
  dex: number,
  type: TypeId,
  level: number,
): Combatant {
  const maxHp = maxHpFor(level);
  return { owner, tile, name, dex, type, level, hp: maxHp, maxHp, protecting: false, usedProtect: false };
}

export function canProtect(c: Combatant): boolean {
  return !c.usedProtect;
}

/** Base damage before variance (includes type multiplier, Protect boost and target's Protect). */
function rawDamage(me: Combatant, foe: Combatant, move: Exclude<MoveKind, 'protect'>, roll: number): number {
  let raw: number;
  if (move === 'tackle') {
    raw = CONFIG.tackle.base + CONFIG.tackle.perLevel * me.level + roll;
  } else {
    const base = CONFIG.typeMove.base + CONFIG.typeMove.perLevel * me.level;
    raw = base * typeMultiplier(me.type, foe.type) + roll;
  }
  if (me.usedProtect) raw *= CONFIG.protect.nextAttackMultiplier;
  if (foe.protecting) raw *= CONFIG.protect.damageTakenMultiplier;
  return Math.max(CONFIG.minDamage, Math.round(raw));
}

export function damageRange(
  me: Combatant,
  foe: Combatant,
  move: Exclude<MoveKind, 'protect'>,
): { min: number; max: number } {
  return { min: rawDamage(me, foe, move, 0), max: rawDamage(me, foe, move, CONFIG.damageVariance) };
}

export function moveName(c: Combatant, move: MoveKind): string {
  if (move === 'tackle') return MOVES.tackle;
  if (move === 'protect') return MOVES.protect;
  return TYPES[c.type].move;
}

/** Applies the side-to-move's move. Mutates battle and rng holder. */
export function applyMove(b: Battle, move: MoveKind, h: RngHolder): void {
  const side = b.turn;
  const me = b.sides[side];
  const foe = b.sides[side === 0 ? 1 : 0];
  me.protecting = false; // protection lasts only until your own next action

  let line: string;
  if (move === 'protect') {
    me.protecting = true;
    me.usedProtect = true;
    line = `${me.name} used ${MOVES.protect}!`;
  } else {
    const roll = nextInt(h, 0, CONFIG.damageVariance);
    const dmg = rawDamage(me, foe, move, roll);
    const mult = move === 'type' ? typeMultiplier(me.type, foe.type) : 1;
    const blocked = foe.protecting;
    foe.hp = Math.max(0, foe.hp - dmg);
    foe.protecting = false;
    me.usedProtect = false;
    let note = '';
    if (mult > 1) note = " It's super effective!";
    else if (mult < 1) note = " It's not very effective…";
    if (blocked) note += ` (${MOVES.protect} softened it)`;
    line = `${me.name} used ${moveName(me, move)}! ${dmg} damage.${note}`;
    b.lastHit = { side: side === 0 ? 1 : 0, damage: dmg, seq: (b.lastHit?.seq ?? 0) + 1 };
  }
  b.moves += 1;
  b.text = [...b.text, line].slice(-2);

  if (foe.hp <= 0) {
    b.winner = side;
    b.endReason = 'ko';
    b.text = [...b.text, `${foe.name} fainted!`].slice(-2);
  } else if (b.moves >= CONFIG.battleMoveCap) {
    const d = b.sides[0].hp / b.sides[0].maxHp;
    const a = b.sides[1].hp / b.sides[1].maxHp;
    b.winner = a > d ? 1 : 0;
    b.endReason = 'cap';
    b.text = [...b.text, `Time's up! ${b.sides[b.winner].name} has more HP left.`].slice(-2);
  } else {
    b.turn = side === 0 ? 1 : 0;
  }
}

export function otherSide(s: Side): Side {
  return s === 0 ? 1 : 0;
}
