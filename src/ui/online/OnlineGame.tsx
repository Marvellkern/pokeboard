import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actorOf } from '../../engine/selectors';
import type { Action, GameState } from '../../engine/types';
import { botRunner, isOnline, seatIsBot, seatOf, type Room } from '../../net/room';
import { GameScreen } from '../GameScreen';
import type { Session } from '../session';
import type { Viewer } from '../viewer';
import { useOnline } from './onlineStore';

const MANUAL_TAKEOVER_MS = 20_000;
const AUTO_TAKEOVER_MS = 60_000;
const MAX_QUEUE = 3;

/**
 * Plays incoming states in order so every device sees the same hops and hits; if more than
 * MAX_QUEUE pile up while animating, skips straight to the latest.
 */
function useDisplayQueue(latest: GameState | null) {
  const [shown, setShown] = useState<GameState | null>(latest);
  const queue = useRef<GameState[]>([]);
  const busy = useRef(false);
  const shownRef = useRef(shown);

  const pump = useCallback(() => {
    if (busy.current || !queue.current.length) return;
    const next = queue.current.length > MAX_QUEUE ? queue.current[queue.current.length - 1] : queue.current[0];
    queue.current = queue.current.length > MAX_QUEUE ? [] : queue.current.slice(1);
    busy.current = true; // until the screen reports in for this state
    shownRef.current = next;
    setShown(next);
  }, []);

  useEffect(() => {
    if (!latest || latest === shownRef.current || queue.current.includes(latest)) return;
    if (!shownRef.current) {
      shownRef.current = latest;
      setShown(latest);
      return;
    }
    queue.current.push(latest);
    pump();
  }, [latest, pump]);

  const onBusyChange = useCallback(
    (b: boolean) => {
      busy.current = b;
      if (!b) pump();
    },
    [pump],
  );
  return { shown, onBusyChange };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function OnlineGame({ room, uid }: { room: Room; uid: string }) {
  const latest = useOnline((s) => s.game);
  const connected = useOnline((s) => s.connected);
  const syncProblem = useOnline((s) => s.syncProblem);
  const store = useOnline.getState();
  const { shown, onBusyChange } = useDisplayQueue(latest);
  const now = useNow();
  const [confirmLeave, setConfirmLeave] = useState(false);

  const mySeat = seatOf(room, uid);
  const viewer: Viewer = useMemo(
    () => ({ online: true, isMe: (pid) => pid !== null && pid === mySeat, isBot: (pid) => pid === null || seatIsBot(room, pid) }),
    [room, mySeat],
  );
  const runsBots = botRunner(room) === uid && connected;
  const isHost = room.meta.hostId === uid;

  // A human seat is waiting on an offline player: offer a bot after 20s (host), do it at 60s.
  const actor = shown ? actorOf(shown) : null;
  const waitingSeat = actor !== null ? room.seats[actor] : null;
  const waitingOffline =
    waitingSeat && waitingSeat.kind === 'human' && !waitingSeat.takeover && !isOnline(room, waitingSeat.playerId) && shown?.phase !== 'gameOver';
  const offlineFor = waitingOffline ? now - (room.presence[waitingSeat.playerId!]?.lastSeen ?? now) : 0;
  useEffect(() => {
    if (waitingOffline && runsBots && actor !== null && offlineFor >= AUTO_TAKEOVER_MS) void store.takeover(actor, true);
  }, [waitingOffline, runsBots, actor, offlineFor, store]);

  // Whoever sees the game end first marks the room finished.
  useEffect(() => {
    if (shown?.phase === 'gameOver' && room.meta.status === 'playing') void store.markFinished();
  }, [shown?.phase, room.meta.status, store]);

  const botAct = useCallback((a: Action) => shown && store.botAct(shown, a), [shown, store]);
  const resolveBotBattle = useCallback(() => store.resolveBotBattle(), [store]);
  if (!shown) return <div className="on-glass m-6 text-center">Loading game…</div>;

  const session: Session = {
    game: shown,
    viewer,
    act: (a) => store.act(a),
    runsBots,
    botAct,
    resolveBotBattle,
    passAndPlay: false,
    connected,
    syncProblem,
    roomCode: room.code,
    playerTags: (pid) => {
      const seat = room.seats[pid];
      const tags: string[] = [];
      if (seat?.left) tags.push('Left · Bot playing');
      else if (seat?.kind === 'human') {
        if (!isOnline(room, seat.playerId)) tags.push('Offline');
        if (seatIsBot(room, pid)) tags.push('Bot playing');
      }
      return { you: pid === mySeat, tags };
    },
    sideSlot:
      waitingOffline && isHost && offlineFor >= MANUAL_TAKEOVER_MS ? (
        <div className="card flex flex-wrap items-center justify-between gap-2 p-3" role="status">
          <span className="text-[14.5px] font-extrabold">
            {waitingSeat!.name} is offline ({Math.floor(offlineFor / 1000)}s).
          </span>
          <button className="btn btn-sm btn-primary" onClick={() => void store.takeover(actor!, true)}>
            Let a bot play for {waitingSeat!.name}
          </button>
        </div>
      ) : confirmLeave ? (
        <div className="card flex flex-wrap items-center justify-between gap-2 p-3" role="alertdialog">
          <span className="text-[14.5px] font-extrabold">Leave for good? A bot takes your seat.</span>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={() => setConfirmLeave(false)}>
              Stay
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void store.leaveGame()}>
              Leave game
            </button>
          </div>
        </div>
      ) : undefined,
    exitButtons: [
      { label: 'Leave game', onClick: () => setConfirmLeave(true) },
      { label: 'Home', onClick: () => store.exit() },
    ],
    playAgain: isHost ? { label: 'Play again', onClick: () => void store.rematch() } : null,
    playAgainNote: isHost ? undefined : 'Waiting for the host to start another game…',
    onBusyChange,
  };
  return <GameScreen key={`${room.code}-${shown.seed}`} session={session} />;
}
