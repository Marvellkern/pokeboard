import type { ReactNode } from 'react';
import type { Action, GameState, PlayerId } from '../engine/types';
import type { Viewer } from './viewer';

export interface SessionButton {
  label: string;
  onClick: () => void;
}

/** Everything the game screen needs from local (pass-and-play) or online play. */
export interface Session {
  game: GameState;
  viewer: Viewer;
  /** A person on this device acts. Stamped with the right seat by the session. */
  act(a: Action): void;
  /** This device plays the bot seats (always locally; online: the host, or a stand-in). */
  runsBots: boolean;
  /** A bot decision, stamped with the bot's seat. */
  botAct(a: Action): void;
  /** Resolve a battle where both sides are bots, at once. */
  resolveBotBattle(): void;
  /** Show the full-screen "[Name]'s turn" hand-over banner (pass-and-play only). */
  passAndPlay: boolean;
  /** False while this device has lost its connection: input is blocked. */
  connected: boolean;
  /** The last update from the server couldn't be read; we kept the previous state. */
  syncProblem: boolean;
  roomCode?: string;
  /** "You" marker and status tags ("offline", "Bot playing") for a player card. */
  playerTags(pid: PlayerId): { you: boolean; tags: string[] };
  /** Extra controls in the side panel (e.g. the host's "Let a bot play for…" button). */
  sideSlot?: ReactNode;
  exitButtons: SessionButton[];
  /** Game over: who may start another game, and what everyone else is told. */
  playAgain: SessionButton | null;
  playAgainNote?: string;
  /** Leave the finished game for the menu. */
  backToMenu: SessionButton;
  /** Online: when a pending trade offer is auto-declined (ms since epoch, this device's clock). */
  tradeDeadline?: number;
  /** Online: the answerer is writing a counter-offer right now. */
  counterWriting?: boolean;
  /** Online: this device opened the counter builder (starts the longer counter timer for everyone). */
  onCounterStart?(): void;
  /** The screen reports when it's animating, so incoming online updates can wait their turn. */
  onBusyChange?(busy: boolean): void;
}
