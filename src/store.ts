import { create } from 'zustand';
import { migrateSave } from './engine/board';
import { createGame, reduce } from './engine/reducer';
import type { Action, GameSetup, GameState } from './engine/types';

const SAVE_KEY = 'pokeboard.save.v1';

function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    // Older saves: attach the classic board (pre-shuffle) and empty ball bags (pre-balls).
    return s && s.version === 1 && Array.isArray(s.players) ? migrateSave(s) : null;
  } catch {
    return null;
  }
}

function writeSave(s: GameState | null): void {
  try {
    if (s) localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage unavailable (private mode, quota). The game keeps working in memory.
  }
}

interface Store {
  game: GameState | null;
  screen: 'setup' | 'game';
  /** A resumable game found in storage at startup (or after quitting). */
  saved: GameState | null;
  start: (setup: GameSetup) => void;
  resume: () => void;
  dispatch: (a: Action) => void;
  /** Apply several actions at once (used for instant bot-vs-bot battles). */
  dispatchMany: (next: (s: GameState) => GameState) => void;
  toSetup: () => void;
  discardSave: () => void;
}

const initialSave = loadSave();

export const useStore = create<Store>((set, get) => ({
  game: null,
  screen: 'setup',
  saved: initialSave && initialSave.phase !== 'gameOver' ? initialSave : null,

  start: (setup) => {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const game = createGame(setup, seed);
    writeSave(game);
    set({ game, screen: 'game', saved: null });
  },

  resume: () => {
    const saved = get().saved;
    if (saved) set({ game: saved, screen: 'game', saved: null });
  },

  dispatch: (a) => {
    const g = get().game;
    if (!g) return;
    const next = reduce(g, a);
    if (next === g) {
      console.warn('Ignored illegal action', a, 'in phase', g.phase);
      return;
    }
    writeSave(next);
    set({ game: next });
  },

  dispatchMany: (fn) => {
    const g = get().game;
    if (!g) return;
    const next = fn(g);
    writeSave(next);
    set({ game: next });
  },

  toSetup: () => {
    const g = get().game;
    set({ screen: 'setup', game: null, saved: g && g.phase !== 'gameOver' ? g : null });
  },

  discardSave: () => {
    writeSave(null);
    set({ saved: null });
  },
}));
