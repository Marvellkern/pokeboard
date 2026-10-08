import { useEffect, useState } from 'react';
import { CONFIG } from '../../data/config';
import { NEUTRAL_TYPE, PLAYER_COLORS, PLAYER_COLOR_NAMES, STARTERS } from '../../data/theme';
import type { BoardMode } from '../../engine/types';
import { MAX_NAME, canStart, isOnline, type Room, type Seat } from '../../net/room';
import { Outlined, Render } from '../common';
import { textOn } from '../format';
import { roomLink, useOnline } from './onlineStore';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-sm on-bg"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt('Copy this:', text);
        }
      }}
    >
      {done ? 'Copied!' : label}
    </button>
  );
}

function SeatCard({ room, seat, idx, uid }: { room: Room; seat: Seat; idx: number; uid: string }) {
  const { hostSetSeat, hostKick } = useOnline.getState();
  const isHost = room.meta.hostId === uid;
  const mine = seat.kind === 'human' && seat.playerId === uid;
  const f = seat.kind !== 'open' ? STARTERS[seat.starter!] : null;
  let status = 'Open seat';
  if (seat.kind === 'bot') status = 'Bot';
  else if (seat.kind === 'human') status = !isOnline(room, seat.playerId) ? 'Offline' : seat.ready ? 'Ready' : 'Not ready';

  return (
    <li
      className={`card flex items-center gap-3 p-3 ${seat.kind === 'open' ? 'opacity-80' : ''}`}
      style={mine ? { outline: '4px solid var(--ink)', outlineOffset: '-4px' } : undefined}
    >
      <span
        className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-white"
        style={{ boxShadow: `inset 0 0 0 5px ${seat.color ?? 'rgba(19,28,63,.2)'}` }}
      >
        {f && <Render dex={f.dex} name={f.name} type={NEUTRAL_TYPE} size={42} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[16px] font-black">{seat.kind === 'open' ? `Seat ${idx + 1}` : seat.name}</span>
          {mine && <span className="chip text-[11px]">You</span>}
          {seat.kind === 'human' && room.meta.hostId === seat.playerId && <span className="chip text-[11px]">Host</span>}
        </div>
        <div className="text-[13px] font-extrabold text-ink-soft">
          {status}
          {f ? ` · ${f.name}` : ''}
        </div>
      </div>
      {isHost && !mine && (
        <div className="flex flex-col gap-1">
          {seat.kind === 'open' && (
            <button className="btn btn-sm" onClick={() => hostSetSeat(idx, 'bot')}>
              Add bot
            </button>
          )}
          {seat.kind === 'bot' && (
            <button className="btn btn-sm" onClick={() => hostSetSeat(idx, 'open')}>
              Open seat
            </button>
          )}
          {seat.kind === 'human' && (
            <button className="btn btn-sm" onClick={() => hostKick(idx)}>
              Remove
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export function LobbyScreen({ room, uid }: { room: Room; uid: string }) {
  const { updateSeat, setSettings, start, leaveLobby } = useOnline.getState();
  const isHost = room.meta.hostId === uid;
  const myIdx = room.seats.findIndex((s) => s.kind === 'human' && s.playerId === uid);
  const me = room.seats[myIdx];
  const [name, setName] = useState(me?.name ?? '');
  const [conflict, setConflict] = useState<string | null>(null);
  useEffect(() => setName(me?.name ?? ''), [me?.name]);
  const others = room.seats.filter((_, k) => k !== myIdx && room.seats[k].kind !== 'open');
  const startable = canStart(room);
  const s = room.meta.settings;

  const claim = async (patch: { starter?: number; color?: string }) => {
    const ok = await updateSeat(patch);
    setConflict(ok ? null : 'Someone just took that one.');
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="on-glass text-[14px]">Room code</span>
        <Outlined as="h1" className="text-[64px] tracking-[0.15em] sm:text-[84px]">
          {room.code}
        </Outlined>
        <div className="flex gap-2">
          <CopyButton text={room.code} label="Copy code" />
          <CopyButton text={roomLink(room.code)} label="Copy link" />
        </div>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Seats">
        {room.seats.map((seat, k) => (
          <SeatCard key={k} room={room} seat={seat} idx={k} uid={uid} />
        ))}
      </ul>

      {me && (
        <section className="card flex flex-col gap-3 p-4" aria-label="Your seat">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-extrabold text-ink-soft">Your name</span>
            <input
              className="font-display h-12 rounded-2xl border-[3px] border-ink px-3 text-[18px] font-semibold"
              value={name}
              maxLength={MAX_NAME}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== me.name && updateSeat({ name })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Your starter">
            {STARTERS.map((f, k) => {
              const taken = others.some((o) => o.starter === k);
              const sel = me.starter === k;
              return (
                <button
                  key={f.dex}
                  className="flex flex-col items-center gap-1 rounded-2xl p-1 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-pressed={sel}
                  aria-label={`${f.name}${taken ? ' (taken)' : ''}`}
                  disabled={taken}
                  onClick={() => !sel && claim({ starter: k })}
                >
                  <span
                    className="flex h-[64px] w-[64px] items-center justify-center rounded-full"
                    style={{
                      background: sel ? 'var(--yellow)' : '#fff',
                      boxShadow: sel ? `inset 0 0 0 5px ${me.color}, 0 4px 0 var(--ink)` : 'inset 0 0 0 3px var(--ink)',
                    }}
                  >
                    <Render dex={f.dex} name={f.name} type={NEUTRAL_TYPE} size={50} />
                  </span>
                  <span className="text-[12.5px] font-extrabold">{f.name}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Your color">
            {PLAYER_COLORS.map((c, k) => {
              const taken = others.some((o) => o.color === c);
              const sel = me.color === c;
              return (
                <button
                  key={c}
                  className="btn btn-sm min-w-12 px-2"
                  style={{ background: c, color: textOn(c), outline: sel ? '3px solid var(--ink)' : undefined, outlineOffset: 3 }}
                  aria-pressed={sel}
                  aria-label={`${PLAYER_COLOR_NAMES[k]}${taken ? ' (taken)' : ''}`}
                  disabled={taken}
                  onClick={() => !sel && claim({ color: c })}
                >
                  {sel ? '✓' : PLAYER_COLOR_NAMES[k][0]}
                </button>
              );
            })}
          </div>
          {conflict && <p className="text-[14px] font-black text-red">{conflict}</p>}
          <button className={`btn btn-lg ${me.ready ? 'btn-yellow' : 'btn-primary'}`} onClick={() => updateSeat({ ready: !me.ready })}>
            {me.ready ? 'Ready! (tap to undo)' : "I'm ready"}
          </button>
        </section>
      )}

      <section className="card flex flex-col gap-3 p-4" aria-label="Game settings">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display mr-1 text-[17px] font-semibold">Rounds</span>
          {CONFIG.roundLimits.map((n) => (
            <button
              key={n}
              className={`btn btn-sm min-w-12 ${n === s.roundLimit ? 'btn-yellow' : ''}`}
              aria-pressed={n === s.roundLimit}
              disabled={!isHost}
              onClick={() => setSettings({ ...s, roundLimit: n })}
            >
              {n}
            </button>
          ))}
          <span className="font-display mr-1 ml-3 text-[17px] font-semibold">Board</span>
          {(['shuffled', 'classic'] as BoardMode[]).map((m) => (
            <button
              key={m}
              className={`btn btn-sm ${m === s.boardMode ? 'btn-yellow' : ''}`}
              aria-pressed={m === s.boardMode}
              disabled={!isHost}
              onClick={() => setSettings({ ...s, boardMode: m })}
            >
              {m === 'shuffled' ? 'Shuffled' : 'Classic'}
            </button>
          ))}
        </div>
        {!isHost && <p className="text-[13px] font-extrabold text-ink-soft">Only the host can change these.</p>}
      </section>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button className="btn btn-lg on-bg" onClick={() => void leaveLobby()}>
          Leave room
        </button>
        {isHost ? (
          <button className="btn btn-primary btn-lg on-bg px-10" disabled={!startable.ok} onClick={() => void start()}>
            Start game
          </button>
        ) : (
          <span className="on-glass text-[15px]">Waiting for the host to start…</span>
        )}
      </div>
      {isHost && !startable.ok && <p className="on-glass self-center text-[14px]">{startable.reason}</p>}
    </main>
  );
}
