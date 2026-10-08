import { createContext, useContext } from 'react';
import type { Battle, GameState, PlayerId } from '../engine/types';

/**
 * Who is looking at the screen. Locally every human seat is "me" (pass-and-play); online only
 * this device's seat is. Bot-ness can change online (a bot covering for an offline player).
 */
export interface Viewer {
  online: boolean;
  /** This device plays this seat (shows its controls, says "You"). */
  isMe(pid: PlayerId | null): boolean;
  /** This seat is played by bot rules right now. null (a grunt) is always a bot. */
  isBot(pid: PlayerId | null): boolean;
}

export const localViewer = (game: GameState): Viewer => ({
  online: false,
  isMe: (pid) => pid !== null && !game.players[pid].isBot,
  isBot: (pid) => pid === null || game.players[pid].isBot,
});

export const ViewerContext = createContext<Viewer | null>(null);

export function useViewer(): Viewer {
  const v = useContext(ViewerContext);
  if (!v) throw new Error('useViewer outside ViewerContext');
  return v;
}

/** Both sides of the battle are bots: resolve instantly and show only a banner. */
export const battleAllBots = (viewer: Viewer, b: Battle | null) => !!b && b.sides.every((c) => viewer.isBot(c.owner));
