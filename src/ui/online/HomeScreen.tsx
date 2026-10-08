import { useState } from 'react';
import { GAME_TITLE, SPRITE_CREDIT, WORDS } from '../../data/theme';
import { NOT_SET_UP_MESSAGE, readNetConfig } from '../../net/config';
import { CODE_LENGTH, CODE_LETTERS, MAX_NAME } from '../../net/room';
import { Outlined } from '../common';
import { rememberedName, useOnline } from './onlineStore';

const onlineReady = readNetConfig() !== null;

export function HomeScreen({ onLocal }: { onLocal: () => void }) {
  const enter = useOnline((s) => s.enter);
  const busy = useOnline((s) => s.busy);
  const error = useOnline((s) => s.error);
  const [name, setName] = useState(rememberedName());
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');
  const [notSetUp, setNotSetUp] = useState(false);

  const pick = (m: 'create' | 'join') => {
    if (!onlineReady) setNotSetUp(true);
    else setMode(m);
  };
  const cleanCode = (v: string) =>
    v
      .toUpperCase()
      .split('')
      .filter((c) => CODE_LETTERS.includes(c))
      .join('')
      .slice(0, CODE_LENGTH);
  const nameOk = name.trim().length > 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center gap-6 px-4 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <Outlined as="h1" className="text-[56px] sm:text-[72px]">
          {GAME_TITLE}
        </Outlined>
        <p className="on-glass text-[17px]">
          Catch {WORDS.creatures}, level them up, and win fee battles, on one device or with friends online.
        </p>
      </header>

      <section className="card flex w-full flex-col gap-3 p-5">
        <button className="btn btn-primary btn-lg w-full" onClick={onLocal}>
          Play on this device
        </button>
        <div className="grid grid-cols-2 gap-3">
          <button className={`btn btn-lg ${mode === 'create' ? 'btn-yellow' : ''}`} onClick={() => pick('create')}>
            Create room
          </button>
          <button className={`btn btn-lg ${mode === 'join' ? 'btn-yellow' : ''}`} onClick={() => pick('join')}>
            Join room
          </button>
        </div>
        {notSetUp && (
          <p className="rounded-2xl border-[3px] border-ink bg-yellow px-3 py-2 text-[15px] font-extrabold" role="status">
            {NOT_SET_UP_MESSAGE} Local play works as usual; see the README to switch online play on.
          </p>
        )}

        {mode !== 'menu' && (
          <form
            className="mt-1 flex flex-col gap-3 border-t-[3px] border-ink/15 pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!nameOk || (mode === 'join' && code.length !== CODE_LENGTH)) return;
              void enter(mode, name, code);
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-extrabold text-ink-soft">Your name</span>
              <input
                className="font-display h-12 rounded-2xl border-[3px] border-ink px-3 text-[18px] font-semibold"
                value={name}
                maxLength={MAX_NAME}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {mode === 'join' && (
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-extrabold text-ink-soft">Room code</span>
                <input
                  className="font-display h-14 rounded-2xl border-[3px] border-ink px-3 text-center text-[28px] font-bold tracking-[0.3em] uppercase"
                  value={code}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="off"
                  placeholder="ABCD"
                  onChange={(e) => setCode(cleanCode(e.target.value))}
                />
              </label>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={busy || !nameOk || (mode === 'join' && code.length !== CODE_LENGTH)}
            >
              {busy ? 'Connecting…' : mode === 'create' ? 'Create room' : 'Join room'}
            </button>
          </form>
        )}
        {error && (
          <p className="text-[15px] font-black text-red" role="alert">
            {error}
          </p>
        )}
      </section>

      <footer className="on-glass mt-auto text-center text-[13px]">A private, non-commercial fan project. {SPRITE_CREDIT}</footer>
    </main>
  );
}
