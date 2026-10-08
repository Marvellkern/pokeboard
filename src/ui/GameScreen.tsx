import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CONFIG } from '../data/config';
import { BALLS, GAME_TITLE, SHOP_BALLS, STARTERS, WORDS, type BallKind } from '../data/theme';
import { chooseAction } from '../engine/bot';
import {
  BOARD_SIZE,
  actorOf,
  canManage,
  shopOpen,
  netWorth,
  ownedTiles,
} from '../engine/selectors';
import type { GameState, PlayerId } from '../engine/types';
import type { Session } from './session';
import { ViewerContext, battleAllBots } from './viewer';
import { BattleOverlay } from './BattleOverlay';
import { Board } from './Board';
import { Avatar, Outlined } from './common';
import { logActor, money, playerColor, prefersReducedMotion, seatLabel, textOn } from './format';
import { ChallengeModal } from './modals/ChallengeModal';
import { FullLogModal, GameOverModal, LiquidateModal, ManageTeamModal } from './modals/OtherModals';
import { TileInfoModal } from './modals/TileModals';
import { TypeChartModal } from './modals/TypeChartModal';
import { ShopModal } from './modals/ShopModal';
import { PropertyCard } from './cards';
import { BallIcon } from './icons';
import { ThrowMedia, throwHeadline, useThrowAnimation } from './Throw';
import { StageButtons, StageInBoard, buildStage, type StageView } from './Stage';

// ── Token / dice animation ───────────────────────────────────────────────────

/** Largest backwards card move (for hopping tokens backwards instead of teleporting). */
const MAX_BACK_STEPS = Math.max(0, ...CONFIG.cards.map((c) => (c.kind === 'move' && c.steps < 0 ? -c.steps : 0)));

function pathBetween(from: number, to: number, teleport: boolean): number[] {
  if (teleport) return [to];
  const fwd = (to - from + BOARD_SIZE) % BOARD_SIZE;
  const back = BOARD_SIZE - fwd;
  const out: number[] = [];
  if (fwd <= CONFIG.dice.count * CONFIG.dice.sides) {
    for (let k = 1; k <= fwd; k++) out.push((from + k) % BOARD_SIZE);
  } else if (back <= MAX_BACK_STEPS) {
    for (let k = 1; k <= back; k++) out.push((from - k + BOARD_SIZE) % BOARD_SIZE);
  } else out.push(to);
  return out;
}

function useBoardAnimation(game: GameState) {
  const [shown, setShown] = useState<number[]>(() => game.players.map((p) => p.position));
  const [rolling, setRolling] = useState(false);
  const [busy, setBusy] = useState(false);
  /** State from before the move started; the side panel shows it so it can't spoil the landing. */
  const [held, setHeld] = useState<GameState | null>(null);
  const shownRef = useRef(shown);
  const prev = useRef(game);
  const gameRef = useRef(game);
  const timers = useRef<number[]>([]);
  gameRef.current = game;

  const finish = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const pos = gameRef.current.players.map((p) => p.position);
    shownRef.current = pos;
    setShown(pos);
    setRolling(false);
    setBusy(false);
    setHeld(null);
  }, []);

  // Layout effect: start the animation before the browser paints, so the landing
  // view (stage card, final dice) never flashes for a frame first.
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (before === game) return;
    const targets = game.players.map((p) => p.position);
    const rolled = game.rollSeq !== before.rollSeq;
    const moved = targets.some((t, i) => t !== shownRef.current[i]);
    if (!rolled && !moved) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setBusy(true);
    setHeld((h) => h ?? before);
    let t = 0;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    if (rolled) {
      setRolling(true);
      t = CONFIG.ui.diceShake;
      at(t, () => setRolling(false));
    }
    game.players.forEach((p, i) => {
      const from = shownRef.current[i];
      if (from === targets[i]) return;
      const teleport = p.inHideout && !before.players[i].inHideout;
      for (const pos of pathBetween(from, targets[i], teleport)) {
        t += CONFIG.ui.hopPerTile;
        at(t, () => {
          shownRef.current = shownRef.current.map((v, j) => (j === i ? pos : v));
          setShown(shownRef.current);
        });
      }
    });
    at(t + 60, finish);
  }, [game, finish]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { shown, rolling, busy, held, skip: finish };
}

/** True when the board is too small to hold the stage card and buttons. */
function useCompact(ref: React.RefObject<HTMLElement | null>, below = 640) {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setCompact(el.getBoundingClientRect().width < below);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, below]);
  return compact;
}

// ── Screen ───────────────────────────────────────────────────────────────────

const CHOICE_PHASES = new Set(['feeChoice', 'ambushChoice', 'hideout']);

export function GameScreen({ session }: { session: Session }) {
  const { game, viewer } = session;

  const { shown, rolling, busy: moving, held, skip: skipMove } = useBoardAnimation(game);
  const { anim: throwAnim, skip: skipThrow } = useThrowAnimation(game, viewer);
  // Anything animating pauses bots and hides human controls; a tap skips it.
  const busy = moving || throwAnim !== null;
  const skip = () => {
    skipMove();
    skipThrow();
  };
  const { onBusyChange } = session;
  // Reported on every new state too, so a queued online update never waits on a stale "busy".
  useEffect(() => onBusyChange?.(busy), [busy, game, onBusyChange]);
  // While the token is moving, the side panel shows the pre-move state plus only the
  // first new log line ("… rolled 3 + 4 = 7."), so cash and events don't give away the landing.
  const panelGame = held ? { ...held, log: game.log.filter((e) => e.id <= held.logSeq + 1) } : game;
  const boardRef = useRef<HTMLElement>(null);
  const compact = useCompact(boardRef);
  const [manageOpen, setManageOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [shopUi, setShopUi] = useState(false);
  const [tileInfo, setTileInfo] = useState<number | null>(null);
  const [liquidateHidden, setLiquidateHidden] = useState(false);
  const [bannerFor, setBannerFor] = useState<number | null>(null);
  const lastBannerTurn = useRef<number>(-1);

  const humans = game.players.filter((p) => viewer.isMe(p.id) && !p.bankrupt).length;
  const actor = actorOf(game);
  const actorIsHuman = actor !== null && viewer.isMe(actor);

  // Pass-and-play cue: whenever the turn passes to a human (and there's more than one).
  useEffect(() => {
    if (!session.passAndPlay || game.phase === 'gameOver') return;
    if (lastBannerTurn.current === game.turnSeq) return;
    lastBannerTurn.current = game.turnSeq;
    if (viewer.isMe(game.current) && humans > 1) setBannerFor(game.current);
  }, [game.turnSeq, game.current, game.phase, humans, session.passAndPlay, viewer]);

  // Close phase-bound modals when the phase moves on.
  useEffect(() => {
    if (!CHOICE_PHASES.has(game.phase)) setPickerOpen(false);
    if (game.phase !== 'debt') setLiquidateHidden(false);
  }, [game.phase]);

  // Bot driver: only on the device that plays the bot seats.
  const { runsBots, botAct, resolveBotBattle } = session;
  useEffect(() => {
    if (!runsBots || busy || bannerFor !== null || game.phase === 'gameOver') return;
    if (game.phase === 'battle' && battleAllBots(viewer, game.battle)) {
      resolveBotBattle();
      return;
    }
    if (game.phase === 'battleOver' && battleAllBots(viewer, game.battle)) {
      const ms = prefersReducedMotion() ? 600 : CONFIG.ui.botBattleBanner;
      const t = window.setTimeout(() => botAct({ type: 'ACK' }), ms);
      return () => clearTimeout(t);
    }
    if (!viewer.isBot(actorOf(game))) return;
    const t = window.setTimeout(() => botAct(chooseAction(game)), CONFIG.ui.botStepDelay);
    return () => clearTimeout(t);
  }, [game, busy, bannerFor, runsBots, botAct, resolveBotBattle, viewer]);

  // Skip animations with a key.
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Escape' || e.key === 'Enter') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The session stamps every action with the seat taking it; the engine rejects anyone else.
  const act = session.act;
  const stageView = buildStage(
    game,
    moving,
    {
      openShop: () => setShopUi(true),
      act,
      openManage: () => setManageOpen(true),
      openPicker: () => setPickerOpen(true),
      openLiquidate: () => setLiquidateHidden(false),
      skipBanner: () => runsBots && botAct({ type: 'ACK' }),
    },
    viewer,
  );
  // While a throw plays, the stage shows it on top of the big card.
  const view: StageView = throwAnim
    ? {
        headline: throwHeadline(game, throwAnim, viewer),
        sub: 'Tap to skip',
        detail: (fixed: boolean) => (
          <PropertyCard game={game} tile={throwAnim.t.tile} fixed={fixed} media={<ThrowMedia game={game} a={throwAnim} />} />
        ),
        actions: [],
      }
    : stageView;

  const showHumanUi = actorIsHuman && !busy && bannerFor === null && session.connected;
  const inBattle = (game.phase === 'battle' || game.phase === 'battleOver') && game.battle !== null;
  const humanBattle = inBattle && !battleAllBots(viewer, game.battle);
  const showMobileBar = compact && view.actions.length > 0 && bannerFor === null && !humanBattle;

  return (
    <ViewerContext.Provider value={viewer}>
      <div className={`min-h-dvh p-2 sm:p-4 lg:p-6 ${showMobileBar ? 'pb-32' : ''}`} onClickCapture={busy ? skip : undefined}>
        <div className="mx-auto flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-center lg:gap-6">
          <main
            ref={boardRef}
            className="mx-auto w-full max-w-[880px] lg:mx-0 lg:w-[min(calc(100dvh-48px),calc(100vw-492px))] lg:max-w-none lg:flex-none"
          >
            <Board
              game={game}
              shownPos={shown}
              onTile={(i) => !busy && setTileInfo(i)}
              stage={<StageInBoard game={game} view={view} rolling={rolling} compact={compact} />}
            />
            {compact && view.detail && (
              <div className="mt-3" onClick={view.onDetailClick}>
                {view.detail(true)}
              </div>
            )}
          </main>

          <aside className="flex w-full flex-col gap-4 lg:w-[420px] lg:flex-none">
            <SideHeader game={panelGame} roomCode={session.roomCode} />
            {session.sideSlot}
            <PlayerCards game={panelGame} tags={session.playerTags} />
            <JustHappened game={panelGame} />
            <div className="grid grid-cols-2 gap-3">
              <button className="btn btn-sm on-bg" onClick={() => setManageOpen(true)}>
                My team
              </button>
              <button className="btn btn-sm on-bg" onClick={() => setChartOpen(true)}>
                Type chart
              </button>
              <button className="btn btn-sm on-bg" onClick={() => setLogOpen(true)}>
                Full log
              </button>
              {session.exitButtons.map((b) => (
                <button key={b.label} className="btn btn-sm on-bg" onClick={b.onClick}>
                  {b.label}
                </button>
              ))}
            </div>
          </aside>
        </div>

        {showMobileBar && session.connected && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t-4 border-ink bg-white px-2 pt-2 pb-3">
            <StageButtons
              actions={view.actions}
              className="flex flex-wrap justify-center gap-2 [&>.btn]:flex-1 [&>.btn]:px-2 [&>.btn]:whitespace-nowrap [&>[data-wide]]:basis-full"
            />
            {view.footnote && <p className="mt-1.5 text-center text-[12.5px] font-extrabold text-ink-soft">{view.footnote}</p>}
          </div>
        )}

        {/* Modals */}
        {showHumanUi && pickerOpen && CHOICE_PHASES.has(game.phase) && (
          <ChallengeModal game={game} onAction={act} onClose={() => setPickerOpen(false)} />
        )}
        {showHumanUi && game.phase === 'debt' && !liquidateHidden && (
          <LiquidateModal game={game} onAction={act} onClose={() => setLiquidateHidden(true)} />
        )}
        {manageOpen && (
          <ManageTeamModal game={game} canAct={showHumanUi && canManage(game)} onAction={act} onClose={() => setManageOpen(false)} />
        )}
        {logOpen && <FullLogModal game={game} onClose={() => setLogOpen(false)} />}
        {chartOpen && <TypeChartModal onClose={() => setChartOpen(false)} />}
        {shopUi && showHumanUi && shopOpen(game) && <ShopModal game={game} onAction={act} onClose={() => setShopUi(false)} />}
        {tileInfo !== null && <TileInfoModal game={game} tile={tileInfo} onClose={() => setTileInfo(null)} />}

        {humanBattle && !busy && (
          <BattleOverlay
            key={`${game.turnSeq}-${game.battle!.sides[1].name}-${game.battle!.kind}`}
            game={game}
            onMove={(m) => actorIsHuman && act({ type: 'MOVE', move: m })}
            onContinue={() => act({ type: 'ACK' })}
          />
        )}

        {game.phase === 'gameOver' && !busy && (
          <GameOverModal game={game} playAgain={session.playAgain} note={session.playAgainNote} />
        )}

        {bannerFor !== null && game.phase !== 'gameOver' && (
          <TurnBanner game={game} pid={bannerFor} onDismiss={() => setBannerFor(null)} />
        )}

        {session.syncProblem && (
          <div className="pill fixed top-3 left-1/2 z-[80] -translate-x-1/2" role="status">
            Sync problem, retrying…
          </div>
        )}
        {!session.connected && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/60 p-4" role="alert" aria-busy="true">
            <div className="card-strong px-6 py-5 text-center">
              <div className="font-display text-[24px] font-bold">Reconnecting…</div>
              <p className="mt-1 text-[15px] text-ink-soft">Your game is safe. It continues as soon as you're back online.</p>
            </div>
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {panelGame.log[panelGame.log.length - 1]?.text}
        </span>
      </div>
    </ViewerContext.Provider>
  );
}

// ── Side panel ───────────────────────────────────────────────────────────────

function SideHeader({ game, roomCode }: { game: GameState; roomCode?: string }) {
  const cur = game.players[game.current];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Outlined as="h1" className="text-[44px]">
        {GAME_TITLE}
      </Outlined>
      <span className="pill text-[17px]">{game.phase === 'gameOver' ? 'Game over' : `${cur.name}'s turn`}</span>
      {roomCode && (
        <span className="chip text-[13px]" title="Room code">
          Room {roomCode}
        </span>
      )}
    </div>
  );
}

function PlayerCards({ game, tags }: { game: GameState; tags: (pid: PlayerId) => { you: boolean; tags: string[] } }) {
  return (
    <section aria-label="Players" className="grid grid-cols-2 gap-3">
      {game.players.map((p) => {
        const active = p.id === game.current && game.phase !== 'gameOver';
        const f = STARTERS[p.starter];
        const owned = ownedTiles(game, p.id).length;
        const meta = p.bankrupt
          ? 'Out'
          : p.inHideout
            ? `In ${WORDS.hideoutShort}`
            : `${owned} ${WORDS.creatures} · Net ${money(netWorth(game, p.id))}`;
        const color = playerColor(p);
        const t = tags(p.id);
        return (
          <div
            key={p.id}
            className={`card flex items-center gap-3 p-3 ${p.bankrupt ? 'opacity-50' : ''}`}
            style={active ? { background: 'var(--yellow)', outline: '4px solid var(--ink)', outlineOffset: '-4px' } : undefined}
            aria-current={active ? 'true' : undefined}
          >
            <Avatar player={p} dex={f.dex} name={f.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="font-display rounded-full px-1.5 text-[11px] leading-[18px] font-bold"
                  style={{ background: color, color: textOn(color) }}
                >
                  {seatLabel(p)}
                </span>
                <span className="truncate text-[15px] font-black">{p.name}</span>
                {t.you && <span className="chip text-[11px]">You</span>}
              </div>
              {t.tags.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag} className="chip text-[11px]" style={{ background: 'var(--ink-soft)' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="font-display text-[26px] leading-tight font-bold">{money(p.cash)}</div>
              <div className="text-[12.5px] leading-snug font-extrabold text-ink-soft" style={active ? { color: 'var(--ink)' } : undefined}>
                {meta}
                {!p.bankrupt && <BallCounts balls={p.balls} />}
                {!p.bankrupt && p.escapeRopes > 0 ? ` · ${WORDS.escapeRope} ×${p.escapeRopes}` : ''}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function JustHappened({ game }: { game: GameState }) {
  const recent = game.log.filter((e) => !e.text.startsWith('──')).slice(-3).reverse();
  return (
    <section className="card px-4 py-3" aria-label="Just happened">
      <h2 className="font-display mb-1.5 text-[17px] font-semibold">Just happened</h2>
      <ol className="flex flex-col gap-1.5">
        {recent.map((e, k) => {
          const who = logActor(game, e.text);
          return (
            <li key={e.id} className={`flex items-start gap-2 text-[14.5px] leading-snug ${k === 0 ? 'text-ink' : 'text-ink-soft'}`}>
              <span
                className="mt-[5px] inline-block h-2.5 w-2.5 flex-none rounded-full border-2 border-ink"
                style={{ background: who ? playerColor(who) : 'var(--ink-soft)' }}
                aria-hidden
              />
              <span className={k === 0 ? 'font-black' : 'font-bold'}>{e.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TurnBanner({ game, pid, onDismiss }: { game: GameState; pid: number; onDismiss: () => void }) {
  const p = game.players[pid];
  const f = STARTERS[p.starter];
  const color = playerColor(p);
  const fg = textOn(color);
  return (
    <button
      className="dots fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 p-4"
      style={{ backgroundColor: color, color: fg }}
      onClick={onDismiss}
      autoFocus
    >
      <Avatar player={p} dex={f.dex} name={f.name} size={140} ring={8} />
      <Outlined className="pop text-center text-[44px] sm:text-[64px]" inverse={fg !== '#FFFFFF'}>
        {p.name}'s turn
      </Outlined>
      <span className="text-[17px] font-extrabold">Pass the device to {p.name}, then tap to continue.</span>
    </button>
  );
}

/** Small ball icons with counts; ball types with 0 are hidden. */
function BallCounts({ balls }: { balls: Record<BallKind, number> }) {
  const shown = SHOP_BALLS.filter((b) => balls[b] > 0);
  if (!shown.length) return null;
  return (
    <span className="mt-1 flex items-center gap-2" aria-label={shown.map((b) => `${balls[b]} ${BALLS[b].name}`).join(', ')}>
      {shown.map((b) => (
        <span key={b} className="font-display inline-flex items-center gap-0.5 text-[13px] font-bold text-ink">
          <BallIcon ball={b} size={18} />×{balls[b]}
        </span>
      ))}
    </span>
  );
}
