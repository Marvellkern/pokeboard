import type { ReactNode } from 'react';
import { CONFIG } from '../data/config';
import { CARD_TEXT, LEGENDARY_BORDER, SPECIAL_TILE_COLORS, TYPES, WORDS, type TileKind } from '../data/theme';
import { battleLevelOfTile, isLegendary, tileFee, tileForm, tilePrice } from '../engine/selectors';
import type { Battle, GameState } from '../engine/types';
import { Chip, PlayerChip, Render, TypeChip } from './common';
import { cardEffectText, money, playerColor, textOn } from './format';
import { TileIcon } from './icons';
import { useViewer, type Viewer } from './viewer';

/** Big type-colored card for a creature tile. `fixed` sizes it for use outside the board. */
export function PropertyCard({
  game,
  tile,
  boxLabel,
  boxAmount,
  media,
  hint,
  fixed = false,
}: {
  game: GameState;
  tile: number;
  /** Label for the white box, e.g. "Price" or "Fee if you lose". Defaults by ownership. */
  boxLabel?: string;
  /** Amount for the white box. Defaults to the fee (owned) or price (wild). */
  boxAmount?: number;
  /** Replaces the render (used by the ball-throw animation). */
  media?: ReactNode;
  hint?: string | null;
  fixed?: boolean;
}) {
  const def = game.board[tile];
  const t = game.tiles[tile];
  const owner = t.owner !== null ? game.players[t.owner] : null;
  const form = tileForm(game, tile);
  const legendary = isLegendary(game, tile);
  const amount = boxAmount ?? (owner ? tileFee(game, tile) : tilePrice(game, tile));
  const label = boxLabel ?? (owner ? 'Fee' : 'Price');
  return (
    <div
      className={`big-card dots ${fixed ? 'fixed-size' : ''}`}
      style={{ backgroundColor: TYPES[def.type!].color, borderColor: legendary ? LEGENDARY_BORDER : '#fff' }}
    >
      {media ?? <Render dex={form.dex} name={form.name} type={def.type!} className="big-card-img" />}
      <div className="big-card-body">
        <div className="big-card-title" style={{ color: textOn(TYPES[def.type!].color) }}>
          {form.name}
        </div>
        <div className="flex flex-wrap gap-[calc(0.6*var(--u))]">
          <TypeChip type={def.type!} />
          {legendary ? (
            <Chip style={{ background: LEGENDARY_BORDER, color: 'var(--ink)' }}>★ {WORDS.legendary} · Lv {battleLevelOfTile(game, tile)}</Chip>
          ) : (
            owner && <Chip>Lv {t.level}</Chip>
          )}
          {owner ? <PlayerChip player={owner} /> : <Chip>Wild</Chip>}
        </div>
        <div className="big-card-box">
          <span className="big-card-box-label">{label}</span>
          <span className="big-card-box-value">{money(amount)}</span>
        </div>
        {hint && <div className="big-card-hint">{hint}</div>}
      </div>
    </div>
  );
}

/** Card for special situations (ambush, hideout, debt, special tiles). */
export function SpecialCard({
  kind,
  title,
  children,
  fixed = false,
}: {
  kind: TileKind;
  title: ReactNode;
  children?: ReactNode;
  fixed?: boolean;
}) {
  const bg = SPECIAL_TILE_COLORS[kind]!;
  return (
    <div className={`big-card dots ${fixed ? 'fixed-size' : ''}`} style={{ backgroundColor: bg, color: textOn(bg) }}>
      <TileIcon kind={kind} className="big-card-icon" />
      <div className="big-card-body">
        <div className="big-card-title">{title}</div>
        {children && <div className="big-card-text">{children}</div>}
      </div>
    </div>
  );
}

/** A drawn card: its text, large, and what it does. */
export function EncounterCard({ game, fixed = false }: { game: GameState; fixed?: boolean }) {
  const card = game.pendingCard!;
  return (
    <SpecialCard kind="card" title={CARD_TEXT[card]} fixed={fixed}>
      {cardEffectText(game, CONFIG.cards[card])}
    </SpecialCard>
  );
}

export function battleOutcome(game: GameState, b: Battle, viewer: Viewer): string {
  const att = game.players[b.attacker];
  const won = b.winner === 1;
  if (b.kind === 'hideout') return won ? `${att.name} escapes the ${WORDS.hideoutShort}.` : `${att.name} stays in the ${WORDS.hideoutShort}.`;
  const to = b.creditor === null ? 'the bank' : game.players[b.creditor].name;
  // Second person only when the attacker is the one human in the battle.
  const def = b.sides[0];
  const attackerIsViewer = viewer.isMe(att.id) && (def.owner === null || !viewer.isMe(def.owner));
  if (attackerIsViewer) return won ? 'No fee paid.' : `Paid ${money(b.stake)} to ${to}.`;
  return won ? `${att.name} pays nothing.` : `${att.name} pays ${money(b.stake)} to ${to}.`;
}

/** Result banner for bot-vs-bot battles: both renders, winner highlighted, money moved. */
export function BattleResultCard({ game, fixed = false }: { game: GameState; fixed?: boolean }) {
  const viewer = useViewer();
  const b = game.battle!;
  const side = (i: 0 | 1) => {
    const c = b.sides[i];
    const owner = c.owner !== null ? game.players[c.owner] : null;
    const won = b.winner === i;
    return (
      <div className={`flex flex-col items-center gap-[calc(0.5*var(--u))] ${won ? '' : 'opacity-60'}`}>
        <div
          className="flex items-center justify-center rounded-full bg-white"
          style={{
            width: 'calc(13 * var(--u))',
            height: 'calc(13 * var(--u))',
            boxShadow: `0 0 0 calc(0.6 * var(--u)) ${won ? LEGENDARY_BORDER : owner ? playerColor(owner) : 'var(--ink-soft)'}`,
          }}
        >
          <Render dex={c.dex} name={c.name} type={c.type} className="h-[85%] w-[85%]" />
        </div>
        <span className="text-[calc(1.5*var(--u))] font-extrabold">{c.name}</span>
        <span className="text-[calc(1.3*var(--u))] opacity-90">{owner ? owner.name : WORDS.grunt}</span>
        {won && <Chip style={{ background: LEGENDARY_BORDER, color: 'var(--ink)', fontSize: 'calc(1.4 * var(--u))' }}>Winner</Chip>}
      </div>
    );
  };
  return (
    <div className={`big-card ${fixed ? 'fixed-size' : ''} flex-col !items-stretch`} style={{ backgroundColor: 'var(--ink)' }}>
      <div className="flex items-start justify-around gap-[calc(1*var(--u))]">
        {side(1)}
        <span className="font-display self-center text-[calc(2.4*var(--u))] font-bold">vs</span>
        {side(0)}
      </div>
      <div className="big-card-box justify-center text-center">
        <span className="big-card-box-label">{battleOutcome(game, b, viewer)}</span>
      </div>
    </div>
  );
}
