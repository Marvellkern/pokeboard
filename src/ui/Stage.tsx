import type { ReactNode } from 'react';
import { CONFIG } from '../data/config';
import { BALLS, SHOP_BALLS, TYPES, WORDS } from '../data/theme';
import { bestFighter } from '../engine/bot';
import {
  actorOf,
  canManage,
  challengeCosts,
  challengeOpponent,
  gruntLevel,
  catchChance,
  isProperty,
  legalActions,
  masterBallCost,
  shopOpen,
  tileFee,
  tileForm,
  typeMultiplier,
} from '../engine/selectors';
import type { Action, GameState } from '../engine/types';
import { BattleResultCard, EncounterCard, PropertyCard, SpecialCard } from './cards';
import { Outlined } from './common';
import { chanceText, money } from './format';
import { BallIcon } from './icons';
import { battleAllBots, type Viewer } from './viewer';

export interface StageAction {
  key: string;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'yellow' | 'default' | 'text';
  disabled?: boolean;
  icon?: ReactNode;
  /** Accessible name when the visible label is short (e.g. a ball count). */
  ariaLabel?: string;
  /** Takes a full row in the phone action bar. */
  wide?: boolean;
}

export interface StageView {
  headline: string;
  sub?: string;
  /** Builds the big card; `fixed` = rendered outside the board (mobile sheet). */
  detail?: (fixed: boolean) => ReactNode;
  onDetailClick?: () => void;
  actions: StageAction[];
  /** Small print under the buttons. */
  footnote?: string;
}

export interface StageHandlers {
  act: (a: Action) => void;
  openManage: () => void;
  openPicker: () => void;
  openLiquidate: () => void;
  skipBanner: () => void;
  openShop: () => void;
}

/** Hint from engine selectors: the current player's best fighter, if it has a type edge. */
function advantageHint(game: GameState, viewer: Viewer): string | null {
  const opp = challengeOpponent(game);
  if (!opp) return null;
  const best = bestFighter(game, game.current, opp.type);
  if (typeMultiplier(best.type, opp.type) <= 1) return null;
  const who = viewer.isMe(game.current) ? 'Your' : `${game.players[game.current].name}'s`;
  return `${who} ${best.name} (${TYPES[best.type].name}) is strong against ${TYPES[opp.type].name}`;
}

export function buildStage(game: GameState, busy: boolean, h: StageHandlers, viewer: Viewer): StageView {
  const cur = game.players[game.current];
  const actor = actorOf(game);
  // "Human" here means: this device takes this decision (pass-and-play: any human; online: my seat).
  const actorIsHuman = actor !== null && viewer.isMe(actor) && game.phase !== 'gameOver';
  const curIsMe = viewer.isMe(game.current);
  const you = curIsMe ? 'You' : cur.name;
  const last = game.log[game.log.length - 1]?.text;
  const thinking =
    actor === null
      ? `${WORDS.grunt} is thinking…`
      : viewer.isBot(actor)
        ? `${game.players[actor].name} is thinking…`
        : `Waiting for ${game.players[actor].name}…`;
  const sub = (humanText?: string) => (actorIsHuman ? humanText : thinking);
  const only = (actions: StageAction[]) => (actorIsHuman ? actions : []);
  const legal = legalActions(game);
  const shop: StageAction[] =
    actorIsHuman && shopOpen(game) ? [{ key: 'shop', label: 'Shop', icon: <BallIcon ball="poke" size={22} />, onClick: h.openShop }] : [];
  const manage: StageAction[] =
    actorIsHuman && canManage(game) ? [{ key: 'manage', label: 'Manage team', onClick: h.openManage }] : [];

  if (busy) {
    return { headline: 'On the move!', sub: 'Tap to skip', actions: [] };
  }

  switch (game.phase) {
    case 'gameOver': {
      const w = game.winner !== null ? game.players[game.winner] : null;
      return { headline: w ? `${w.name} wins!` : 'Game over', actions: [] };
    }

    case 'roll':
      return {
        headline: curIsMe ? 'Your turn!' : `${cur.name}'s turn`,
        sub: sub(cur.inHideout ? undefined : 'Roll the dice to move.'),
        actions: only([{ key: 'roll', label: 'Roll', variant: 'primary', onClick: () => h.act({ type: 'ROLL' }) }, ...shop, ...manage]),
      };

    case 'buy': {
      // Catch choices come from the engine's legal THROW actions; chances from catchChance().
      const i = game.pendingTile!;
      const throwable = new Set(legal.flatMap((a) => (a.type === 'THROW' ? [a.ball] : [])));
      const carried: StageAction[] = SHOP_BALLS.filter((b) => throwable.has(b)).map((b) => ({
        key: b,
        label: `×${cur.balls[b]} · ${chanceText(catchChance(game, i, b))}`,
        ariaLabel: `${BALLS[b].name}, ${cur.balls[b]} carried, ${chanceText(catchChance(game, i, b))} catch chance`,
        icon: <BallIcon ball={b} size={24} />,
        onClick: () => h.act({ type: 'THROW', ball: b }),
      }));
      const canMaster = throwable.has('master');
      return {
        headline: `A wild ${game.board[i].name}!`,
        sub: sub(),
        detail: (fixed) => <PropertyCard game={game} tile={i} boxLabel="Price" fixed={fixed} />,
        actions: only([
          ...carried,
          {
            key: 'master',
            label: canMaster
              ? `${BALLS.master.name} ${money(masterBallCost(game, i))} · 100%`
              : `${BALLS.master.name} ${money(masterBallCost(game, i))} · Not enough money`,
            icon: <BallIcon ball="master" size={24} />,
            variant: 'primary',
            wide: true,
            disabled: !canMaster,
            onClick: () => h.act({ type: 'THROW', ball: 'master' }),
          },
          { key: 'skip', label: 'Skip', variant: 'text', onClick: () => h.act({ type: 'SKIP' }) },
        ]),
        footnote: actorIsHuman ? 'One throw per landing.' : undefined,
      };
    }

    case 'feeChoice': {
      const i = game.pendingTile!;
      const fee = tileFee(game, i);
      return {
        headline: `${you} landed on ${tileForm(game, i).name}!`,
        sub: sub(),
        detail: (fixed) => (
          <PropertyCard
            game={game}
            tile={i}
            boxLabel="Fee if you lose"
            boxAmount={challengeCosts(game)!.loseBattle}
            hint={advantageHint(game, viewer)}
            fixed={fixed}
          />
        ),
        actions: only([
          { key: 'battle', label: 'Battle!', variant: 'primary', onClick: h.openPicker },
          { key: 'pay', label: `Pay ${money(fee)}`, onClick: () => h.act({ type: 'PAY' }) },
        ]),
      };
    }

    case 'ambushChoice':
      return {
        headline: `${WORDS.gruntTeam} ambush!`,
        sub: sub(),
        detail: (fixed) => (
          <SpecialCard kind="ambush" title={`${WORDS.grunt} · Lv ${gruntLevel(game.round)}`} fixed={fixed}>
            Lose and pay {money(challengeCosts(game)!.loseBattle)} to the bank. Win and pay nothing.
          </SpecialCard>
        ),
        actions: only([
          { key: 'battle', label: 'Battle!', variant: 'primary', onClick: h.openPicker },
          { key: 'pay', label: `Pay ${money(challengeCosts(game)!.pay)}`, onClick: () => h.act({ type: 'PAY' }) },
        ]),
      };

    case 'hideout':
      return {
        headline: `Locked in the ${WORDS.hideoutShort}!`,
        sub: sub(),
        detail: (fixed) => (
          <SpecialCard kind="hideout" title={`${WORDS.guard[0].toUpperCase()}${WORDS.guard.slice(1)} · Lv ${gruntLevel(game.round)}`} fixed={fixed}>
            Beat the guard to leave free, or pay {money(CONFIG.hideout.fee)}. Failed tries: {cur.hideoutFails}/
            {CONFIG.hideout.maxFailedTurns}.
          </SpecialCard>
        ),
        actions: only([
          { key: 'battle', label: 'Battle the guard!', variant: 'primary', onClick: h.openPicker },
          { key: 'pay', label: `Pay ${money(CONFIG.hideout.fee)}`, onClick: () => h.act({ type: 'PAY' }) },
          ...(cur.escapeRopes > 0
            ? [{ key: 'rope', label: `Use ${WORDS.escapeRope}`, variant: 'yellow' as const, onClick: () => h.act({ type: 'USE_ROPE' }) }]
            : []),
          ...shop,
          ...manage,
        ]),
      };

    case 'card':
      return {
        headline: `${WORDS.card}!`,
        sub: sub(),
        detail: (fixed) => <EncounterCard game={game} fixed={fixed} />,
        actions: only([{ key: 'ok', label: 'OK', variant: 'primary', onClick: () => h.act({ type: 'ACK' }) }]),
      };

    case 'battle':
    case 'battleOver': {
      if (game.phase === 'battleOver' && battleAllBots(viewer, game.battle)) {
        return {
          headline: 'Battle!',
          sub: 'Tap to skip',
          detail: (fixed) => <BattleResultCard game={game} fixed={fixed} />,
          onDetailClick: h.skipBanner,
          actions: [],
        };
      }
      return { headline: 'Battle!', sub: 'Battle in progress…', actions: [] };
    }

    case 'debt': {
      const d = game.debt!;
      const debtor = game.players[d.debtor];
      const to = d.creditor === null ? 'the bank' : game.players[d.creditor].name;
      return {
        headline: 'Not enough money!',
        sub: sub(),
        detail: (fixed) => (
          <SpecialCard kind="card" title={`${debtor.name} owes ${money(d.amount)}`} fixed={fixed}>
            To {to}, with only {money(debtor.cash)} in hand. Release {WORDS.creatures} to pay.
          </SpecialCard>
        ),
        actions: only([{ key: 'release', label: `Release ${WORDS.creatures}…`, variant: 'primary', onClick: h.openLiquidate }]),
      };
    }

    case 'endTurn': {
      const actions = only([
        ...manage,
        { key: 'end', label: 'End turn', variant: 'primary', onClick: () => h.act({ type: 'END_TURN' }) },
      ]);
      const pos = cur.position;
      const def = game.board[pos];
      if (isProperty(game, pos)) {
        const owner = game.tiles[pos].owner;
        const name = tileForm(game, pos).name;
        let headline: string;
        const justCaught = game.log.slice(-6).some((e) => e.text.startsWith(`${cur.name} threw`) && e.text.includes(game.board[pos].name) && e.text.endsWith('caught!'));
        if (owner === game.current) headline = justCaught ? `Caught ${name}!` : `${curIsMe ? 'Your' : `${cur.name}'s`} ${name}`;
        else if (owner === null) {
          const missed = game.lastThrow && game.lastThrow.tile === pos && game.lastThrow.player === game.current && !game.lastThrow.caught;
          const thisTurn = game.log.slice(-6).some((e) => e.text.startsWith(`${cur.name} threw`) && e.text.includes(name));
          headline = missed && thisTurn ? 'Oh no! It broke free!' : `${you} passed on ${name}`;
        }
        else headline = `${you} landed on ${name}!`;
        return {
          headline,
          sub: sub(owner !== null && owner !== game.current ? last : undefined) ,
          detail: (fixed) => <PropertyCard game={game} tile={pos} fixed={fixed} />,
          actions,
        };
      }
      let headline: string = def.name;
      if (def.kind === 'go') headline = `${you} landed on ${def.name}!`;
      else if (def.kind === 'bonus') headline = `+${money(CONFIG.bonusTilePayout)} at the ${def.name}`;
      else if (def.kind === 'hideout' && cur.inHideout) headline = `Sent to the ${WORDS.hideoutShort}!`;
      else if (def.kind === 'hideout') headline = `Just visiting the ${WORDS.hideoutShort}`;
      else if (def.kind === 'ambush') headline = `${WORDS.gruntTeam} ambush!`;
      else if (def.kind === 'card') headline = `${WORDS.card}!`;
      return { headline, sub: actorIsHuman ? last : thinking, actions };
    }
  }
}

/** The stage inside the board: round chip, dice, headline, and (unless compact) card + buttons. */
export function StageInBoard({
  game,
  view,
  rolling,
  compact,
}: {
  game: GameState;
  view: StageView;
  rolling: boolean;
  compact: boolean;
}) {
  const dice = game.lastRoll ?? Array(CONFIG.dice.count).fill(null);
  return (
    <>
      <div className="stage-top">
        <span className="chip stage-round">
          Round {game.round} / {game.roundLimit}
        </span>
        <div className="flex gap-[1cqw]" aria-label={game.lastRoll ? `Last roll ${game.lastRoll.join(' and ')}` : 'No roll yet'}>
          {dice.map((d: number | null, k: number) => (
            <div key={`${k}-${rolling ? 'r' : game.rollSeq}`} className={`die ${rolling ? 'shake' : ''}`}>
              {rolling || d === null ? '?' : d}
            </div>
          ))}
        </div>
      </div>
      <Outlined as="h2" className="stage-headline" key={view.headline}>
        <span className="pop inline-block">{view.headline}</span>
      </Outlined>
      {!compact && view.detail && (
        <div className="w-full max-w-[54cqw]" onClick={view.onDetailClick}>
          {view.detail(false)}
        </div>
      )}
      {view.sub && <p className="stage-sub">{view.sub}</p>}
      {!compact && view.actions.length > 0 && <StageButtons actions={view.actions} />}
      {!compact && view.footnote && <p className="stage-footnote">{view.footnote}</p>}
    </>
  );
}

export function StageButtons({ actions, className = 'stage-actions' }: { actions: StageAction[]; className?: string }) {
  return (
    <div className={className}>
      {actions.map((a) => (
        <button
          key={a.key}
          className={`btn ${a.variant === 'primary' ? 'btn-primary' : a.variant === 'yellow' ? 'btn-yellow' : a.variant === 'text' ? 'btn-text' : ''}`}
          disabled={a.disabled}
          aria-label={a.ariaLabel}
          data-wide={a.wide ? '' : undefined}
          onClick={a.onClick}
        >
          {a.icon}
          {a.label}
        </button>
      ))}
    </div>
  );
}
