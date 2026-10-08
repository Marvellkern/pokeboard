import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { BALLS } from '../data/theme';
import { tileForm, tileType } from '../engine/selectors';
import type { GameState, ThrowResult } from '../engine/types';
import { Render } from './common';
import { prefersReducedMotion } from './format';
import { BallIcon } from './icons';
import type { Viewer } from './viewer';

export interface ThrowAnim {
  t: ThrowResult;
  step: 'arc' | 'shake' | 'result';
  shake: number;
  /** Step length in ms (bots play a faster version). */
  ms: number;
}

// Human throws: arc 500 + up to 3 rocks × 500 + result 700 ≤ 2.7s. Bot throws: about 0.8s total.
const HUMAN = { arc: 500, shake: 500, result: 700 };
const BOT = { arc: 200, shake: 150, result: 150 };

/**
 * Plays back the latest throw recorded in the game state. The outcome is already in the state,
 * so a refresh mid-throw just shows the resolved game (the animation isn't saved).
 */
export function useThrowAnimation(game: GameState, viewer: Viewer) {
  const [anim, setAnim] = useState<ThrowAnim | null>(null);
  const seen = useRef(game.lastThrow?.seq ?? 0);
  const timers = useRef<number[]>([]);

  const skip = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setAnim(null);
  }, []);

  useLayoutEffect(() => {
    const t = game.lastThrow;
    if (!t || t.seq <= seen.current) return;
    seen.current = t.seq;
    if (prefersReducedMotion()) return; // show the result straight away
    const speed = viewer.isBot(t.player) ? BOT : HUMAN;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setAnim({ t, step: 'arc', shake: 0, ms: speed.arc });
    let time = speed.arc;
    for (let k = 1; k <= t.shakes; k++) {
      at(time, () => setAnim({ t, step: 'shake', shake: k, ms: speed.shake }));
      time += speed.shake;
    }
    at(time, () => setAnim({ t, step: 'result', shake: t.shakes, ms: speed.result }));
    at(time + speed.result, () => setAnim(null));
  }, [game.lastThrow]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { anim, skip };
}

export function throwHeadline(game: GameState, a: ThrowAnim, viewer: Viewer): string {
  const name = game.board[a.t.tile].name;
  if (a.step !== 'result') {
    const who = game.players[a.t.player];
    return `${viewer.isMe(who.id) ? 'You' : who.name} threw a ${BALLS[a.t.ball].name}!`;
  }
  return a.t.caught ? `Gotcha! ${name} was caught!` : 'Oh no! It broke free!';
}

/** The animation, drawn where the big card's render normally sits. */
export function ThrowMedia({ game, a }: { game: GameState; a: ThrowAnim }) {
  const form = tileForm(game, a.t.tile);
  const style = { '--step-ms': `${a.ms}ms` } as CSSProperties;
  const mon = (cls: string) => (
    <Render dex={form.dex} name={form.name} type={tileType(game, a.t.tile)} className={`throw-mon ${cls}`} />
  );
  return (
    <div className="big-card-img throw-media" style={style} aria-live="polite">
      {a.step === 'arc' && (
        <>
          {mon('shrink')}
          <BallIcon ball={a.t.ball} size="42%" className="throw-ball arc" />
        </>
      )}
      {a.step === 'shake' && <BallIcon key={a.shake} ball={a.t.ball} size="42%" className="throw-ball rock" />}
      {a.step === 'result' && a.t.caught && (
        <>
          <BallIcon ball={a.t.ball} size="42%" className="throw-ball click" />
          <span className="throw-burst" aria-hidden>
            {Array.from({ length: 6 }, (_, k) => (
              <span key={k} style={{ '--k': k } as CSSProperties}>✦</span>
            ))}
          </span>
        </>
      )}
      {a.step === 'result' && !a.t.caught && (
        <>
          {mon('reappear')}
          <BallIcon ball={a.t.ball} size="42%" className="throw-ball popopen" />
        </>
      )}
    </div>
  );
}
