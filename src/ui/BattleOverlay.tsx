import { useState } from 'react';
import { CONFIG } from '../data/config';
import { BATTLE_GRADIENTS, GRUNT_BATTLE_GRADIENT, MOVES, NEUTRAL_TYPE, PROTECT_COLOR, TYPES, WORDS } from '../data/theme';
import { canProtect, damageRange, moveName, typeMultiplier } from '../engine/battle';
import type { Battle, Combatant, GameState, MoveKind, Side } from '../engine/types';
import { battleOutcome } from './cards';
import { Chip, HpBar, Outlined, Render, TypeChip } from './common';
import { money, playerColor, textOn } from './format';
import { useViewer, type Viewer } from './viewer';
import { actorOf } from '../engine/selectors';
import { TypeChartModal } from './modals/TypeChartModal';


function title(b: Battle): string {
  if (b.kind === 'fee') return 'Fee Battle!';
  if (b.kind === 'ambush') return 'Ambush!';
  return `${WORDS.hideoutShort} Guard!`;
}

function stakeText(game: GameState, b: Battle, viewer: Viewer): string {
  const att = game.players[b.attacker];
  // "You" only when the attacker is the sole human in this battle; otherwise name them.
  // "You" only when this device plays the attacker and not also the defender (pass-and-play).
  const attIsMe = viewer.isMe(att.id);
  const defIsMe = b.sides[0].owner !== null && viewer.isMe(b.sides[0].owner);
  const subject = attIsMe && !defIsMe ? 'If you lose' : `If ${att.name} loses`;
  if (b.kind === 'hideout') {
    return `${subject}: stay in the ${WORDS.hideoutShort} (${att.hideoutFails + 1}/${CONFIG.hideout.maxFailedTurns})`;
  }
  const to = b.creditor === null ? 'the bank' : game.players[b.creditor].name;
  return `${subject}: pay ${money(b.stake)} to ${to}`;
}

/** Headline from the point of view of the human in the battle (if exactly one). */
function resultHeadline(game: GameState, b: Battle, viewer: Viewer): string {
  const humans = ([0, 1] as Side[]).filter((s) => b.sides[s].owner !== null && viewer.isMe(b.sides[s].owner));
  if (humans.length === 1) return b.winner === humans[0] ? 'You won!' : 'You lost!';
  const w = b.sides[b.winner!];
  return `${w.owner !== null ? game.players[w.owner].name : w.name} won!`;
}

function HpPlate({ game, c, role }: { game: GameState; c: Combatant; role: string }) {
  const owner = c.owner !== null ? game.players[c.owner] : null;
  return (
    <div className="card-strong w-full max-w-[400px] px-2.5 py-1.5 sm:px-4 sm:py-3">
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <span className="font-display mr-auto text-[18px] leading-tight font-bold sm:text-[26px]">{c.name}</span>
        <TypeChip type={c.type} className="text-[12px] sm:text-[15px]" />
        <Chip className="text-[12px] sm:text-[15px]">Lv {c.level}</Chip>
      </div>
      <div className="mt-1.5">
        <HpBar hp={c.hp} max={c.maxHp} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-soft sm:text-[14px]">
        {owner && <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-ink" style={{ background: playerColor(owner) }} />}
        {owner ? owner.name : WORDS.grunt} · {role}
        {c.protecting && <Chip style={{ background: PROTECT_COLOR }}>{MOVES.protect} up</Chip>}
        {c.usedProtect && !c.protecting && <Chip>Charged</Chip>}
      </div>
    </div>
  );
}

function Fighter({ c, side, b }: { c: Combatant; side: Side; b: Battle }) {
  const hit = b.lastHit;
  const iWasHit = hit && hit.side === side;
  const iHit = hit && hit.side !== side;
  // Attacker sits bottom-left and lunges up-right; defender lunges down-left.
  const lunge = iHit ? (side === 1 ? 'lunge-up' : 'lunge-down') : '';
  const size = side === 1 ? 'min(310px, 34vw, 25dvh)' : 'min(270px, 30vw, 22dvh)';
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Spotlight: keeps a type-colored creature from blending into its type-colored background. */}
      <div className="spotlight" aria-hidden />
      <div key={`l-${hit?.seq ?? 0}`} className={`relative h-full w-full ${lunge}`}>
        <div key={`f-${hit?.seq ?? 0}`} className={`render-shadow h-full w-full ${iWasHit ? 'hit-flash' : ''}`}>
          <Render
            dex={c.dex}
            name={c.name}
            type={c.type}
            size="100%"
            mirrored={side === 1}
            className={c.hp <= 0 ? 'opacity-40' : ''}
          />
        </div>
      </div>
    </div>
  );
}

/** Background follows the defender's type; grunt battles always use the grunt gradient. */
function battleBackground(b: Battle): React.CSSProperties {
  const def = b.sides[0];
  const [top, bottom] = def.owner === null ? GRUNT_BATTLE_GRADIENT : BATTLE_GRADIENTS[def.type];
  return {
    backgroundColor: bottom,
    backgroundImage: `var(--dots-page), linear-gradient(170deg, ${top} 0%, ${bottom} 100%)`,
    backgroundSize: '22px 22px, 100% 100%',
  };
}

function MoveCard({
  me,
  foe,
  move,
  onClick,
  enabled,
}: {
  me: Combatant;
  foe: Combatant;
  move: MoveKind;
  onClick: () => void;
  enabled: boolean;
}) {
  const disabled = !enabled || (move === 'protect' && !canProtect(me));
  let bg: string;
  let stats: [string, string][];
  let tag: { text: string; yellow?: boolean };
  if (move === 'protect') {
    bg = PROTECT_COLOR;
    const taken = CONFIG.protect.damageTakenMultiplier;
    stats = [
      ['Next hit taken', taken === 0.5 ? '½' : `×${taken}`],
      ['Your next attack', `+${Math.round((CONFIG.protect.nextAttackMultiplier - 1) * 100)}%`],
    ];
    tag = { text: "Can't use twice in a row" };
  } else {
    const type = move === 'tackle' ? NEUTRAL_TYPE : me.type;
    bg = TYPES[type].color;
    const r = damageRange(me, foe, move);
    stats = [
      ['Damage', `${r.min}–${r.max}`],
      ['Type', TYPES[type].name],
    ];
    if (move === 'tackle') tag = { text: 'Ignores types' };
    else {
      const m = typeMultiplier(me.type, foe.type);
      tag =
        m > 1
          ? { text: `Super effective ×${m}`, yellow: true }
          : m < 1
            ? { text: `Not very effective ×${m}` }
            : { text: 'Neutral ×1' };
    }
  }
  return (
    <button className="move-card dots flex-1" style={{ backgroundColor: bg }} disabled={disabled} onClick={onClick}>
      <Outlined className="move-name">{moveName(me, move)}</Outlined>
      <div className="flex gap-2 max-sm:hidden">
        {stats.map(([label, value]) => (
          <div key={label} className="move-stat">
            <div className="text-[12px] font-extrabold opacity-85">{label}</div>
            <div className="font-display text-[22px] font-bold">{value}</div>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1.5 sm:justify-center sm:gap-2">
        <span className="move-stat flex-none rounded-full px-2.5 py-0.5 text-[14px] font-black whitespace-nowrap sm:hidden">{stats[0][1]}</span>
        <span className="move-tag" style={tag.yellow ? { background: 'var(--yellow)' } : undefined}>
          {tag.text}
        </span>
      </div>
    </button>
  );
}

export function BattleOverlay({
  game,
  onMove,
  onContinue,
}: {
  game: GameState;
  onMove: (m: MoveKind) => void;
  onContinue: () => void;
}) {
  const viewer = useViewer();
  const b = game.battle!;
  const [chartOpen, setChartOpen] = useState(false);
  const [def, att] = b.sides;
  const over = game.phase === 'battleOver';
  const mover = b.sides[b.turn];
  const foe = b.sides[b.turn === 0 ? 1 : 0];
  const humanMoves = !over && mover.owner !== null && viewer.isMe(mover.owner);
  const moverOwner = mover.owner !== null ? game.players[mover.owner] : null;
  const showWhose = humanMoves && ((def.owner !== null && viewer.isMe(def.owner)) || mover === def);
  // Online, only the device whose decision it is confirms the result; the others wait.
  const continuer = actorOf(game);
  const canContinue = over && continuer !== null && viewer.isMe(continuer);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={battleBackground(b)}
      role="dialog"
      aria-modal="true"
      aria-label="Battle"
    >
      <div className="battle mx-auto flex min-h-full max-w-[1240px] flex-col gap-2.5 p-3 sm:gap-5 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <Outlined as="h2" className="text-[28px] sm:text-[38px]">
            {title(b)}
          </Outlined>
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill text-[13px] sm:text-[17px]">{stakeText(game, b, viewer)}</span>
            <button className="btn btn-sm on-bg" onClick={() => setChartOpen(true)}>
              Type chart
            </button>
          </div>
        </header>

        <div className="grid flex-1 grid-cols-2 grid-rows-2 items-center gap-2 sm:gap-4">
          <div className="flex justify-start">
            <HpPlate game={game} c={def} role="defending" />
          </div>
          <div className="flex justify-center">
            <Fighter c={def} side={0} b={b} />
          </div>
          <div className="flex justify-center">
            <Fighter c={att} side={1} b={b} />
          </div>
          <div className="flex justify-end">
            <HpPlate game={game} c={att} role="attacking" />
          </div>
        </div>

        <div className="card-strong min-h-[56px] px-3 py-2 text-[15px] leading-snug font-extrabold sm:min-h-[72px] sm:px-4 sm:py-2.5 sm:text-[19px]" aria-live="polite">
          {b.text.slice(-2).map((t, i) => (
            <div key={`${b.moves}-${i}`}>{t}</div>
          ))}
        </div>

        {over ? (
          <div className="card-strong pop flex flex-col items-center gap-2 p-4 text-center">
            <Outlined className="text-[40px] sm:text-[52px]">{resultHeadline(game, b, viewer)}</Outlined>
            <div className="text-[18px] font-black">{battleOutcome(game, b, viewer)}</div>
            {canContinue ? (
              <button className="btn btn-primary btn-lg" onClick={onContinue} autoFocus>
                Continue
              </button>
            ) : (
              <div className="text-[16px] font-extrabold text-ink-soft">
                Waiting for {continuer !== null ? game.players[continuer].name : 'the others'}…
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {showWhose && moverOwner && (
              <div className="self-start">
                <span
                  className="chip text-[15px]"
                  style={{ background: playerColor(moverOwner), color: textOn(playerColor(moverOwner)) }}
                >
                  {moverOwner.name}'s pick · {mover.name}
                </span>
              </div>
            )}
            {!humanMoves && (
              <div className="card px-4 py-2 text-center text-[16px] font-extrabold text-ink-soft">
                {mover.name}
                {moverOwner ? ` (${moverOwner.name})` : ''} is choosing a move…
              </div>
            )}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-4">
              {(['tackle', 'type', 'protect'] as MoveKind[]).map((m) => (
                <MoveCard key={m} me={mover} foe={foe} move={m} enabled={humanMoves} onClick={() => onMove(m)} />
              ))}
            </div>
          </div>
        )}
      </div>
      {chartOpen && <TypeChartModal above onClose={() => setChartOpen(false)} />}
    </div>
  );
}
