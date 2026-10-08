import { CONFIG } from '../data/config';
import { BALLS, CURRENCY, LEGACY_PLAYER_COLORS, PLAYER_COLORS, WORDS, TYPES, type TypeId } from '../data/theme';
import { GO_TILE } from '../engine/selectors';
import type { BallBlock, HasBoard, LevelBlock } from '../engine/selectors';
import type { CardEffect, GameState, Player } from '../engine/types';

export const money = (n: number) => `${CURRENCY}${n.toLocaleString('en-US')}`;

export function levelBlockText(reason: LevelBlock, type: TypeId | null): string {
  switch (reason) {
    case 'maxLevel':
      return 'Max level';
    case 'needPair':
      return `Need both ${type ? TYPES[type].name : ''} ${WORDS.creatures}`.replace('  ', ' ');
    case 'cash':
      return 'Not enough money';
    case 'legendary':
      return `${WORDS.legendary} ${WORDS.creatures} can't level`;
    case 'notOwner':
      return 'Not yours';
  }
}

export function cardEffectText(game: HasBoard, e: CardEffect): string {
  const goName = game.board[GO_TILE].name;
  switch (e.kind) {
    case 'gain':
      return `Collect ${money(e.amount)}.`;
    case 'lose':
      return `Pay ${money(e.amount)} to the bank.`;
    case 'rareCandy':
      return `One of your ${WORDS.creatures} gains a level for free. If none can, collect ${money(e.fallback)}.`;
    case 'advanceToGo':
      return `Advance to ${goName} and collect ${money(CONFIG.goPayout)}.`;
    case 'move':
      return e.steps > 0 ? `Move forward ${e.steps} tiles.` : `Move back ${-e.steps} tiles (no ${goName} money).`;
    case 'goToHideout':
      return `Go to the ${WORDS.hideoutShort}. No ${goName} money.`;
    case 'escapeRope':
      return `Keep this. Use it to leave the ${WORDS.hideoutShort} for free.`;
    case 'birthday':
      return `Every other player pays you ${money(e.amount)}.`;
    case 'gainBall':
      return `Gain 1 ${BALLS[e.ball].name}. If your bag is full (${CONFIG.balls.carryLimit}), collect ${money(e.fallback)} instead.`;
  }
}

export function ballBlockText(reason: BallBlock): string {
  if (reason === 'bagFull') return 'Bag is full';
  if (reason === 'cash') return 'Not enough money';
  return 'Shop is closed';
}

/** Catch chance as a whole percentage, rounded down. */
export const chanceText = (c: number) => `${Math.floor(c * 100 + 1e-9)}%`;

export function multiplierTag(m: number): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  if (m > 1) return { text: `Effective ×${m}`, tone: 'good' };
  if (m < 1) return { text: `Resisted ×${m}`, tone: 'bad' };
  return { text: 'Neutral ×1', tone: 'neutral' };
}

/** "P1" for humans, "B2" for bots: never rely on color alone. */
export const seatLabel = (p: Player) => `${p.isBot ? 'B' : 'P'}${p.id + 1}`;

/** Player color, mapping colors from saves made before the redesign. */
export function playerColor(p: Player): string {
  const legacy = LEGACY_PLAYER_COLORS.findIndex((c) => c.toLowerCase() === p.color.toLowerCase());
  return legacy >= 0 ? PLAYER_COLORS[legacy] : p.color;
}

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Ink or white, whichever reads better on this background (white never on yellow). */
export function textOn(bg: string): string {
  const l = luminance(bg);
  const vsWhite = 1.05 / (l + 0.05);
  const vsInk = (l + 0.05) / (luminance('#131C3F') + 0.05);
  return vsWhite >= 4.5 || vsWhite > vsInk ? '#FFFFFF' : '#131C3F';
}

/** Darker shade of a color (for type chips with white text). */
export function shade(hex: string, factor = 0.55): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * factor));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The player a log line is about (first player name mentioned), for colored dots. */
export function logActor(game: GameState, text: string): Player | null {
  let best: Player | null = null;
  let at = Infinity;
  for (const p of game.players) {
    const i = text.indexOf(p.name);
    if (i >= 0 && i < at) {
      at = i;
      best = p;
    }
  }
  return best;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
