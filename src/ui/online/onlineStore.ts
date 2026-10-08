// Client-side state for an online room. All networking goes through src/net.

import { create } from 'zustand';
import { chooseAction } from '../../engine/bot';
import { actorOf } from '../../engine/selectors';
import type { Action, GameState } from '../../engine/types';
import type { Backend, Unsubscribe } from '../../net/backend';
import { NOT_SET_UP_MESSAGE, readNetConfig } from '../../net/config';
import * as R from '../../net/room';

const NAME_KEY = 'pokeboard.name';

export function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}
export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, R.sanitizeName(name));
  } catch {
    /* storage unavailable */
  }
}

/** ?room=ABCD in the address bar, so a refresh or a shared link rejoins. */
export function roomFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('room');
  return code && /^[A-Za-z]{4}$/.test(code) ? code.toUpperCase() : null;
}
function setUrlRoom(code: string | null) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}
export const roomLink = (code: string) => {
  const url = new URL(window.location.href);
  url.search = `?room=${code}`;
  return url.toString();
};

const JOIN_ERRORS: Record<string, string> = {
  notFound: "There's no room with that code.",
  expired: 'That room has expired (rooms last 24 hours).',
  full: 'That room is full.',
  started: "That game has already started, and you weren't part of it.",
};

let backend: Backend | null = null;
let backendPromise: Promise<Backend | null> | null = null;
/** One backend (and so one signed-in player) per page, even if several calls race to create it. */
function getBackend(): Promise<Backend | null> {
  backendPromise ??= (async () => {
    const cfg = readNetConfig();
    if (!cfg) return null;
    const { createFirebaseBackend } = await import('../../net/firebaseBackend');
    backend = createFirebaseBackend(cfg);
    return backend;
  })();
  return backendPromise;
}

interface OnlineStore {
  uid: string | null;
  code: string | null;
  room: R.Room | null;
  /** Latest accepted game state (the screen may still be animating an older one). */
  game: GameState | null;
  syncProblem: boolean;
  connected: boolean;
  busy: boolean;
  error: string | null;

  enter(kind: 'create' | 'join', name: string, code?: string): Promise<boolean>;
  exit(): void;
  leaveLobby(): Promise<void>;
  leaveGame(): Promise<void>;
  updateSeat(patch: R.SeatPatch): Promise<boolean>;
  hostSetSeat(idx: number, kind: 'bot' | 'open'): Promise<void>;
  hostKick(idx: number): Promise<void>;
  setSettings(s: R.RoomSettings): Promise<void>;
  start(): Promise<void>;
  rematch(): Promise<void>;
  takeover(idx: number, on: boolean): Promise<void>;
  markFinished(): Promise<void>;
  /** A person on this device acts for their own seat. */
  act(a: Action): void;
  /** The bot-running device acts for the seat that's deciding. */
  botAct(state: GameState, a: Action): void;
  resolveBotBattle(): void;
  clearError(): void;
}

let unsubs: Unsubscribe[] = [];
let feed = new R.GameFeed();

export const useOnline = create<OnlineStore>((set, get) => {
  const be = () => backend!;
  const mySeat = () => {
    const { room, uid } = get();
    return room && uid ? R.seatOf(room, uid) : -1;
  };

  function subscribe(code: string, uid: string) {
    unsubs.forEach((u) => u());
    feed = new R.GameFeed();
    unsubs = [
      R.subscribeRoom(be(), code, (room) => {
        if (!room) {
          set({ room: null, error: 'This room was closed.' });
          return;
        }
        const next: Partial<OnlineStore> = { room };
        if (room.game) {
          const state = feed.accept(room.game);
          if (state) next.game = state;
          next.syncProblem = feed.problem;
        } else if (room.meta.status === 'lobby') {
          feed = new R.GameFeed(); // rematch: a fresh game will start at version 1
          next.game = null;
        }
        set(next);
        // Back online after a bot covered for us: take our seat back.
        const idx = R.seatOf(room, uid);
        if (idx >= 0 && room.seats[idx].takeover && get().connected) void R.setTakeover(be(), code, idx, false);
      }),
      R.trackPresence(be(), code, uid, (connected) => set({ connected })),
    ];
  }

  const submit = (a: Action) => {
    const { code } = get();
    if (!code) return;
    void R.submitAction(be(), code, a);
  };

  return {
    uid: null,
    code: null,
    room: null,
    game: null,
    syncProblem: false,
    connected: true,
    busy: false,
    error: null,

    async enter(kind, name, code) {
      if (get().busy || get().code) return false; // already joining / in a room
      set({ busy: true, error: null });
      try {
        if (!(await getBackend())) {
          set({ error: NOT_SET_UP_MESSAGE });
          return false;
        }
        const uid = await be().signIn();
        rememberName(name);
        let roomCode: string;
        if (kind === 'create') {
          roomCode = await R.createRoom(be(), uid, name);
        } else {
          const res = await R.joinRoom(be(), uid, (code ?? '').toUpperCase(), name);
          if (!res.ok) {
            set({ error: JOIN_ERRORS[res.reason] });
            return false;
          }
          roomCode = res.room.code;
        }
        set({ uid, code: roomCode });
        setUrlRoom(roomCode);
        subscribe(roomCode, uid);
        return true;
      } catch (e) {
        console.error(e);
        const code = (e as { code?: string })?.code ?? '';
        set({
          error:
            ['auth/operation-not-allowed', 'auth/admin-restricted-operation', 'auth/configuration-not-found'].includes(code)
              ? 'Online play is set up, but Anonymous sign-in is off. The site owner needs to enable it in Firebase (Authentication → Sign-in method).'
              : "Couldn't reach the game server. Check your connection and try again.",
        });
        return false;
      } finally {
        set({ busy: false });
      }
    },

    exit() {
      unsubs.forEach((u) => u());
      unsubs = [];
      setUrlRoom(null);
      set({ code: null, room: null, game: null, error: null, syncProblem: false });
    },

    async leaveLobby() {
      const { code, uid } = get();
      if (code && uid) await R.leaveLobby(be(), code, uid);
      get().exit();
    },
    async leaveGame() {
      const { code, uid } = get();
      if (code && uid) await R.leaveGame(be(), code, uid);
      get().exit();
    },
    async updateSeat(patch) {
      const { code, uid } = get();
      if (patch.name !== undefined) rememberName(patch.name);
      return !!code && !!uid && (await R.updateMySeat(be(), code, uid, patch));
    },
    async hostSetSeat(idx, kind) {
      await R.hostSetSeat(be(), get().code!, idx, kind);
    },
    async hostKick(idx) {
      await R.hostKick(be(), get().code!, idx);
    },
    async setSettings(s) {
      await R.setSettings(be(), get().code!, s);
    },
    async start() {
      const { code, uid } = get();
      await R.startGame(be(), code!, uid!, Math.floor(Math.random() * 2 ** 31));
    },
    async rematch() {
      const { code, uid } = get();
      await R.rematch(be(), code!, uid!);
    },
    async takeover(idx, on) {
      await R.setTakeover(be(), get().code!, idx, on);
    },
    async markFinished() {
      await R.markFinished(be(), get().code!);
    },
    act(a) {
      const seat = mySeat();
      if (seat >= 0) submit({ ...a, by: seat });
    },
    botAct(state, a) {
      submit({ ...a, by: actorOf(state) });
    },
    resolveBotBattle() {
      const { code } = get();
      if (code) void R.submitRun(be(), code, (s) => (s.phase === 'battle' ? { ...chooseAction(s), by: actorOf(s) } : null));
    },
    clearError() {
      set({ error: null });
    },
  };
});
