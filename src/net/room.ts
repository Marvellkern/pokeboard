// Room lobby and game sync on top of a Backend. No UI here; everything is testable with
// MemoryBackend. The engine stays the single source of rules: every game write runs `reduce`
// inside a transaction on rooms/{code}/game.

import { CONFIG } from '../data/config';
import { PLAYER_COLORS, STARTERS } from '../data/theme';
import { migrateSave } from '../engine/board';
import { createGame, reduce } from '../engine/reducer';
import { isLegal } from '../engine/selectors';
import type { Action, BoardMode, GameState } from '../engine/types';
import type { Backend, Unsubscribe } from './backend';

export const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: codes are read aloud
export const CODE_LENGTH = 4;
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_SEATS = CONFIG.maxPlayers;
export const MAX_NAME = 12;

export type SeatKind = 'open' | 'human' | 'bot';
export interface Seat {
  kind: SeatKind;
  playerId?: string;
  name?: string;
  starter?: number;
  color?: string;
  ready?: boolean;
  /** A bot plays this human's seat while they're offline. */
  takeover?: boolean;
  /** The human left for good; the seat stays a bot. */
  left?: boolean;
}
export interface RoomSettings {
  roundLimit: number;
  boardMode: BoardMode;
}
export type RoomStatus = 'lobby' | 'playing' | 'finished';
export interface RoomMeta {
  hostId: string;
  createdAt: number;
  status: RoomStatus;
  settings: RoomSettings;
}
export interface Presence {
  online: boolean;
  lastSeen: number;
}
export interface GameNode {
  version: number;
  stateJson: string;
}
export interface Room {
  code: string;
  meta: RoomMeta;
  seats: Seat[];
  presence: Record<string, Presence>;
  game: GameNode | null;
}

export const roomPath = (code: string) => `rooms/${code}`;
const OPEN: Seat = { kind: 'open' };

// ── Parsing (never trust incoming shapes) ────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function sanitizeName(raw: unknown): string {
  // Plain text only: strip control characters, trim, cap the length.
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME);
}

function parseSeat(v: unknown): Seat {
  if (!isObj(v)) return { ...OPEN };
  const kind: SeatKind = v.kind === 'human' || v.kind === 'bot' ? v.kind : 'open';
  if (kind === 'open') return { ...OPEN };
  return {
    kind,
    playerId: typeof v.playerId === 'string' ? v.playerId : undefined,
    name: sanitizeName(v.name) || (kind === 'bot' ? 'Bot' : 'Player'),
    starter: typeof v.starter === 'number' && STARTERS[v.starter] ? v.starter : 0,
    color: typeof v.color === 'string' && PLAYER_COLORS.includes(v.color) ? v.color : PLAYER_COLORS[0],
    ready: v.ready === true,
    takeover: v.takeover === true,
    left: v.left === true,
  };
}

/** Seats come back as an array or (if sparse) an object keyed by index. Always returns MAX_SEATS. */
export function parseSeats(v: unknown): Seat[] {
  const out: Seat[] = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    const raw = Array.isArray(v) ? v[i] : isObj(v) ? v[String(i)] : undefined;
    out.push(parseSeat(raw));
  }
  return out;
}

export function parseRoom(code: string, raw: unknown): Room | null {
  if (!isObj(raw) || !isObj(raw.meta)) return null;
  const m = raw.meta;
  if (typeof m.hostId !== 'string' || typeof m.createdAt !== 'number') return null;
  const s = isObj(m.settings) ? m.settings : {};
  const status: RoomStatus = m.status === 'playing' || m.status === 'finished' ? m.status : 'lobby';
  const presence: Record<string, Presence> = {};
  if (isObj(raw.presence)) {
    for (const [id, p] of Object.entries(raw.presence)) {
      if (isObj(p)) presence[id] = { online: p.online === true, lastSeen: typeof p.lastSeen === 'number' ? p.lastSeen : 0 };
    }
  }
  const g = raw.game;
  const game = isObj(g) && typeof g.version === 'number' && typeof g.stateJson === 'string' ? { version: g.version, stateJson: g.stateJson } : null;
  return {
    code,
    meta: {
      hostId: m.hostId,
      createdAt: m.createdAt,
      status,
      settings: {
        roundLimit: typeof s.roundLimit === 'number' && CONFIG.roundLimits.includes(s.roundLimit) ? s.roundLimit : CONFIG.defaultRoundLimit,
        boardMode: s.boardMode === 'classic' ? 'classic' : 'shuffled',
      },
    },
    seats: parseSeats(raw.seats),
    presence,
    game,
  };
}

/** Parse and sanity-check a game state from the database. Returns null if it's unusable. */
export function parseState(json: string): GameState | null {
  try {
    const s = JSON.parse(json);
    if (!isObj(s) || !Array.isArray(s.players) || !Array.isArray(s.tiles) || typeof s.phase !== 'string') return null;
    if (!s.players.every((p: unknown) => isObj(p) && typeof p.cash === 'number')) return null;
    return migrateSave(s as unknown as GameState);
  } catch {
    return null;
  }
}

export const isExpired = (meta: RoomMeta, now: number) => now - meta.createdAt > ROOM_TTL_MS;

// ── Seats and who controls them ──────────────────────────────────────────────

export const isOnline = (room: Room, playerId: string | undefined) => !!playerId && room.presence[playerId]?.online === true;

export const seatOf = (room: Room, playerId: string) => room.seats.findIndex((s) => s.kind === 'human' && s.playerId === playerId);

/** Played by bot rules right now: a bot seat, or a human seat taken over while they're offline. */
export function seatIsBot(room: Room, idx: number): boolean {
  const s = room.seats[idx];
  if (!s) return true;
  return s.kind === 'bot' || (s.kind === 'human' && !!s.takeover && !isOnline(room, s.playerId));
}

/** The device that plays bot seats: the host if online, else the online human in the lowest seat. */
export function botRunner(room: Room): string | null {
  if (isOnline(room, room.meta.hostId)) return room.meta.hostId;
  const s = room.seats.find((seat) => seat.kind === 'human' && isOnline(room, seat.playerId));
  return s?.playerId ?? null;
}

export function canStart(room: Room): { ok: boolean; reason: string | null } {
  const filled = room.seats.filter((s) => s.kind !== 'open');
  const humans = filled.filter((s) => s.kind === 'human');
  const bots = filled.length - humans.length;
  if (filled.length < 2) return { ok: false, reason: 'Need at least 2 players' };
  if (humans.length < 2 && bots < 1) return { ok: false, reason: 'Wait for a friend or add a bot' };
  if (humans.some((s) => !s.ready)) return { ok: false, reason: 'Waiting for everyone to be ready' };
  return { ok: true, reason: null };
}

const firstFree = <T>(all: T[], taken: T[]) => all.find((x) => !taken.includes(x));

// ── Lobby operations ─────────────────────────────────────────────────────────

export function newCode(rand: () => number = Math.random): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_LETTERS[Math.floor(rand() * CODE_LETTERS.length)]).join('');
}

export async function createRoom(be: Backend, uid: string, name: string, now = Date.now(), rand = Math.random): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const code = newCode(rand);
    const res = await be.transaction<Record<string, unknown>>(roomPath(code), (cur) => {
      const existing = cur ? parseRoom(code, cur) : null;
      if (existing && !isExpired(existing.meta, now)) return undefined; // code in use
      return {
        meta: { hostId: uid, createdAt: now, status: 'lobby', settings: { roundLimit: CONFIG.defaultRoundLimit, boardMode: 'shuffled' } },
        seats: [{ kind: 'human', playerId: uid, name: sanitizeName(name) || 'Player', starter: 0, color: PLAYER_COLORS[0], ready: false }, OPEN, OPEN, OPEN],
      };
    });
    if (res.committed) return code;
  }
  throw new Error('Could not find a free room code');
}

export type JoinResult = { ok: true; seat: number; room: Room } | { ok: false; reason: 'notFound' | 'expired' | 'full' | 'started' };

export async function joinRoom(be: Backend, uid: string, code: string, name: string, now = Date.now()): Promise<JoinResult> {
  const room = parseRoom(code, await be.read(roomPath(code)));
  if (!room) return { ok: false, reason: 'notFound' };
  if (isExpired(room.meta, now)) return { ok: false, reason: 'expired' };
  if (seatOf(room, uid) >= 0) return { ok: true, seat: seatOf(room, uid), room }; // rejoin
  if (room.meta.status !== 'lobby') return { ok: false, reason: 'started' };

  await be.transaction<unknown>(`${roomPath(code)}/seats`, (cur) => {
    if (cur === null) return null; // not cached yet: the database retries with the real value
    const seats = parseSeats(cur);
    if (seats.some((s) => s.playerId === uid)) return undefined;
    const idx = seats.findIndex((s) => s.kind === 'open');
    if (idx < 0) return undefined;
    const used = seats.filter((s) => s.kind !== 'open');
    seats[idx] = {
      kind: 'human',
      playerId: uid,
      name: sanitizeName(name) || `Player ${idx + 1}`,
      starter: firstFree(STARTERS.map((_, k) => k), used.map((s) => s.starter!)) ?? 0,
      color: firstFree(PLAYER_COLORS, used.map((s) => s.color!)) ?? PLAYER_COLORS[0],
      ready: false,
    };
    return seats;
  });
  const after = parseRoom(code, await be.read(roomPath(code)));
  const seat = after ? seatOf(after, uid) : -1;
  return seat >= 0 && after ? { ok: true, seat, room: after } : { ok: false, reason: 'full' };
}

export interface SeatPatch {
  name?: string;
  starter?: number;
  color?: string;
  ready?: boolean;
}

/**
 * Change your own seat. Starter and color are claimed inside the transaction, so two players
 * can't grab the same one at the same moment. Changing anything but `ready` un-readies you.
 */
export async function updateMySeat(be: Backend, code: string, uid: string, patch: SeatPatch): Promise<boolean> {
  const res = await be.transaction<unknown>(`${roomPath(code)}/seats`, (cur) => {
    if (cur === null) return null;
    const seats = parseSeats(cur);
    const idx = seats.findIndex((s) => s.kind === 'human' && s.playerId === uid);
    if (idx < 0) return undefined;
    const others = seats.filter((_, k) => k !== idx && seats[k].kind !== 'open');
    if (patch.starter !== undefined && others.some((s) => s.starter === patch.starter)) return undefined;
    if (patch.color !== undefined && others.some((s) => s.color === patch.color)) return undefined;
    const changed = patch.name !== undefined || patch.starter !== undefined || patch.color !== undefined;
    seats[idx] = {
      ...seats[idx],
      ...(patch.name !== undefined ? { name: sanitizeName(patch.name) || seats[idx].name } : {}),
      ...(patch.starter !== undefined ? { starter: patch.starter } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ready: patch.ready !== undefined ? patch.ready : changed ? false : seats[idx].ready,
    };
    return seats;
  });
  return res.committed;
}

/** Host: make an empty seat a bot, or a bot seat open again. */
export async function hostSetSeat(be: Backend, code: string, idx: number, kind: 'bot' | 'open'): Promise<boolean> {
  const res = await be.transaction<unknown>(`${roomPath(code)}/seats`, (cur) => {
    if (cur === null) return null;
    const seats = parseSeats(cur);
    if (seats[idx].kind === 'human') return undefined;
    if (kind === 'open') {
      seats[idx] = { ...OPEN };
      return seats;
    }
    const used = seats.filter((s) => s.kind !== 'open');
    seats[idx] = {
      kind: 'bot',
      name: `Bot ${idx + 1}`,
      starter: firstFree(STARTERS.map((_, k) => k), used.map((s) => s.starter!)) ?? 0,
      color: firstFree(PLAYER_COLORS, used.map((s) => s.color!)) ?? PLAYER_COLORS[0],
      ready: true,
    };
    return seats;
  });
  return res.committed;
}

/** Host: remove a player from a seat. */
export async function hostKick(be: Backend, code: string, idx: number): Promise<boolean> {
  const res = await be.transaction<unknown>(`${roomPath(code)}/seats`, (cur) => {
    if (cur === null) return null;
    const seats = parseSeats(cur);
    seats[idx] = { ...OPEN };
    return seats;
  });
  return res.committed;
}

export async function setSettings(be: Backend, code: string, settings: RoomSettings): Promise<void> {
  await be.write(`${roomPath(code)}/meta/settings`, settings);
}

/** Leave the lobby. The next human in seat order becomes host; an empty room is abandoned. */
export async function leaveLobby(be: Backend, code: string, uid: string): Promise<void> {
  await be.transaction<Record<string, unknown>>(roomPath(code), (cur) => {
    if (cur === null) return null;
    const room = parseRoom(code, cur);
    if (!room) return undefined;
    const idx = seatOf(room, uid);
    if (idx < 0) return undefined;
    room.seats[idx] = { ...OPEN };
    const humans = room.seats.filter((s) => s.kind === 'human');
    if (!humans.length) return null; // abandoned
    const hostId = room.meta.hostId === uid ? humans[0].playerId! : room.meta.hostId;
    return { ...cur, meta: { ...room.meta, hostId }, seats: room.seats };
  });
}

/**
 * Host: start the game. Filled seats are packed to the front so seat index = engine player id.
 * The initial state is written as version 1.
 */
export async function startGame(be: Backend, code: string, uid: string, seed: number): Promise<boolean> {
  const res = await be.transaction<Record<string, unknown>>(roomPath(code), (cur) => {
    if (cur === null) return null;
    const room = parseRoom(code, cur);
    if (!room || room.meta.hostId !== uid || room.meta.status !== 'lobby' || !canStart(room).ok) return undefined;
    const filled = room.seats.filter((s) => s.kind !== 'open');
    const seats = [...filled, ...Array(MAX_SEATS - filled.length).fill(OPEN)];
    const state = createGame(
      {
        players: filled.map((s) => ({ name: s.name!, color: s.color!, isBot: s.kind === 'bot', starter: s.starter! })),
        roundLimit: room.meta.settings.roundLimit,
        boardMode: room.meta.settings.boardMode,
      },
      seed,
    );
    return { ...cur, meta: { ...room.meta, status: 'playing' }, seats, game: { version: 1, stateJson: JSON.stringify(state) } };
  });
  return res.committed;
}

// ── Game sync ────────────────────────────────────────────────────────────────

export type SubmitResult = 'applied' | 'rejected';

/**
 * Apply an action in a transaction: parse the latest state, check it's legal for the seat named
 * in `action.by`, reduce, and write version + 1. If someone else wrote first the transaction
 * reruns on their state; if the action is no longer legal there, nothing is written.
 */
export async function submitAction(be: Backend, code: string, action: Action): Promise<SubmitResult> {
  const res = await be.transaction<GameNode>(`${roomPath(code)}/game`, (cur) => {
    if (cur === null) return null; // not cached yet; retried with the server value
    const state = parseState(cur.stateJson);
    if (!state || !isLegal(state, action)) return undefined;
    return { version: cur.version + 1, stateJson: JSON.stringify(reduce(state, action)) };
  });
  return res.committed && res.value !== null ? 'applied' : 'rejected';
}

/**
 * Apply a run of actions in one transaction (a bot-vs-bot battle resolves at once, as locally).
 * `next` returns the next action for a state, or null to stop.
 */
export async function submitRun(be: Backend, code: string, next: (s: GameState) => Action | null, max = 100): Promise<SubmitResult> {
  const res = await be.transaction<GameNode>(`${roomPath(code)}/game`, (cur) => {
    if (cur === null) return null;
    let state = parseState(cur.stateJson);
    if (!state) return undefined;
    let applied = 0;
    for (let k = 0; k < max; k++) {
      const a = next(state);
      if (!a || !isLegal(state, a)) break;
      state = reduce(state, a);
      applied++;
    }
    if (!applied) return undefined;
    return { version: cur.version + 1, stateJson: JSON.stringify(state) };
  });
  return res.committed && res.value !== null ? 'applied' : 'rejected';
}

/** Keeps only updates that are newer than what we have, and only states that parse. */
export class GameFeed {
  version = 0;
  state: GameState | null = null;
  /** The last update failed to parse; we kept the previous state. */
  problem = false;

  accept(node: unknown): GameState | null {
    if (!isObj(node) || typeof node.version !== 'number' || typeof node.stateJson !== 'string') return null;
    if (node.version <= this.version) return null; // stale or duplicate
    const state = parseState(node.stateJson);
    if (!state) {
      this.problem = true;
      return null;
    }
    this.problem = false;
    this.version = node.version;
    this.state = state;
    return state;
  }
}

export function subscribeRoom(be: Backend, code: string, cb: (room: Room | null) => void): Unsubscribe {
  return be.subscribe(roomPath(code), (raw) => cb(parseRoom(code, raw)));
}

// ── Presence, takeover, leaving, rematch ─────────────────────────────────────

/** Mark this device online whenever it's connected; the server marks it offline when it drops. */
export function trackPresence(be: Backend, code: string, uid: string, onConnected: (c: boolean) => void): Unsubscribe {
  const path = `${roomPath(code)}/presence/${uid}`;
  return be.onConnection((connected) => {
    onConnected(connected);
    if (!connected) return;
    void be.onDisconnectWrite(path, { online: false, lastSeen: be.serverTime() });
    void be.write(path, { online: true, lastSeen: be.serverTime() });
  });
}

export async function setTakeover(be: Backend, code: string, idx: number, on: boolean): Promise<void> {
  await be.transaction<unknown>(`${roomPath(code)}/seats`, (cur) => {
    if (cur === null) return null;
    const seats = parseSeats(cur);
    if (seats[idx].kind !== 'human' || !!seats[idx].takeover === on) return undefined;
    seats[idx] = { ...seats[idx], takeover: on };
    return seats;
  });
}

/** Leave a running game for good: the seat becomes a bot. */
export async function leaveGame(be: Backend, code: string, uid: string): Promise<void> {
  await be.transaction<unknown>(`${roomPath(code)}/seats`, (cur) => {
    if (cur === null) return null;
    const seats = parseSeats(cur);
    const idx = seats.findIndex((s) => s.kind === 'human' && s.playerId === uid);
    if (idx < 0) return undefined;
    seats[idx] = { ...seats[idx], kind: 'bot', playerId: undefined, takeover: false, left: true, ready: true };
    return seats;
  });
}

export async function markFinished(be: Backend, code: string): Promise<void> {
  await be.transaction<Record<string, unknown>>(`${roomPath(code)}/meta`, (cur) => {
    if (cur === null) return null;
    if (cur.status !== 'playing') return undefined;
    return { ...cur, status: 'finished' };
  });
}

/** Host: back to the lobby with the same seats, everyone un-readied. */
export async function rematch(be: Backend, code: string, uid: string): Promise<boolean> {
  const res = await be.transaction<Record<string, unknown>>(roomPath(code), (cur) => {
    if (cur === null) return null;
    const room = parseRoom(code, cur);
    if (!room || room.meta.hostId !== uid || room.meta.status === 'lobby') return undefined;
    const seats = room.seats.map((s) => (s.kind === 'open' ? s : { ...s, ready: s.kind === 'bot', takeover: false }));
    const { game: _game, ...rest } = cur;
    return { ...rest, meta: { ...room.meta, status: 'lobby' }, seats };
  });
  return res.committed;
}
