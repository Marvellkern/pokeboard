import { useEffect, useMemo, useState } from 'react';
import { GAME_TITLE } from './data/theme';
import { chooseAction } from './engine/bot';
import { reduce } from './engine/reducer';
import { actorOf } from './engine/selectors';
import { useStore } from './store';
import { GameScreen } from './ui/GameScreen';
import { HomeScreen } from './ui/online/HomeScreen';
import { LobbyScreen } from './ui/online/LobbyScreen';
import { OnlineGame } from './ui/online/OnlineGame';
import { rememberedName, roomFromUrl, useOnline } from './ui/online/onlineStore';
import type { Session } from './ui/session';
import { SetupScreen } from './ui/SetupScreen';
import { localViewer } from './ui/viewer';

/** Auto-join from ?room= once per page load (effects can run twice in development). */
let autoJoinTried = false;

/** Pass-and-play on this device: every human seat is "me", this device plays the bots. */
function LocalGame() {
  const game = useStore((s) => s.game)!;
  const dispatch = useStore((s) => s.dispatch);
  const dispatchMany = useStore((s) => s.dispatchMany);
  const toSetup = useStore((s) => s.toSetup);
  const discardSave = useStore((s) => s.discardSave);
  const viewer = useMemo(() => localViewer(game), [game]);
  const session: Session = {
    game,
    viewer,
    act: (a) => dispatch({ ...a, by: actorOf(game) }),
    runsBots: true,
    botAct: (a) => dispatch({ ...a, by: actorOf(game) }),
    resolveBotBattle: () =>
      dispatchMany((s) => {
        let st = s;
        for (let k = 0; k < 100 && st.phase === 'battle'; k++) st = reduce(st, { ...chooseAction(st), by: actorOf(st) });
        return st;
      }),
    passAndPlay: true,
    connected: true,
    syncProblem: false,
    playerTags: () => ({ you: false, tags: [] }),
    exitButtons: [{ label: 'Save & exit', onClick: toSetup }],
    playAgain: {
      label: 'Play again',
      onClick: () => {
        discardSave();
        toSetup();
      },
    },
  };
  return <GameScreen key={game.seed} session={session} />;
}

function OnlineApp() {
  const room = useOnline((s) => s.room);
  const uid = useOnline((s) => s.uid);
  const error = useOnline((s) => s.error);
  const exit = useOnline((s) => s.exit);
  if (!room || !uid) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="on-glass text-[17px]">{error ?? 'Connecting…'}</p>
        <button className="btn on-bg" onClick={exit}>
          Back home
        </button>
      </main>
    );
  }
  if (room.meta.status === 'lobby') return <LobbyScreen room={room} uid={uid} />;
  return <OnlineGame room={room} uid={uid} />;
}

export default function App() {
  const screen = useStore((s) => s.screen);
  const game = useStore((s) => s.game);
  const onlineCode = useOnline((s) => s.code);
  const enter = useOnline((s) => s.enter);
  const [mode, setMode] = useState<'home' | 'local'>('home');

  useEffect(() => {
    document.title = GAME_TITLE;
    // A shared link (or a refresh inside a room) goes straight to that room.
    const code = roomFromUrl();
    if (code && !autoJoinTried) {
      autoJoinTried = true;
      void enter('join', rememberedName() || 'Player', code);
    }
  }, [enter]);

  if (onlineCode) return <OnlineApp />;
  if (mode === 'home' && screen !== 'game') return <HomeScreen onLocal={() => setMode('local')} />;
  if (screen === 'game' && game) return <LocalGame />;
  return <SetupScreen onHome={() => setMode('home')} />;
}
