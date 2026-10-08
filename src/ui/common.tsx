import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NEUTRAL_TYPE, TYPES, renderImage, type TypeId } from '../data/theme';
import type { Player } from '../engine/types';
import { playerColor, seatLabel, shade, textOn } from './format';

/** Hot-linked 3D render with a type-colored fallback circle if the image fails. */
export function Render({
  dex,
  name,
  type,
  size,
  mirrored = false,
  className = '',
  style,
}: {
  dex: number;
  name: string;
  type: TypeId;
  size?: number | string;
  mirrored?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const src = renderImage(dex);
  const [failed, setFailed] = useState<string | null>(null);
  const dims = size !== undefined ? { width: size, height: size } : {};
  if (failed === src) {
    return (
      <div
        className={`flex items-center justify-center rounded-full border-[3px] border-white text-center font-extrabold leading-tight text-white ${className}`}
        style={{ ...dims, ...style, background: TYPES[type].color, fontSize: 'max(9px, 0.9em)', aspectRatio: '1' }}
        role="img"
        aria-label={name}
      >
        <span className="px-1">{name}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(src)}
      className={`select-none ${mirrored ? 'mirror' : ''} ${className}`}
      style={{ ...dims, objectFit: 'contain', ...style }}
    />
  );
}

/** Type chip: darker shade of the type color so white text stays readable. */
export function TypeChip({ type, className = '' }: { type: TypeId; className?: string }) {
  return (
    <span className={`chip ${className}`} style={{ background: shade(TYPES[type].color) }}>
      {TYPES[type].name}
    </span>
  );
}

export function Chip({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={`chip ${className}`} style={style}>
      {children}
    </span>
  );
}

/** Owner / player chip in the player's color, with the seat label (never color alone). */
export function PlayerChip({ player, className = '' }: { player: Player; className?: string }) {
  const bg = playerColor(player);
  return (
    <span className={`chip ${className}`} style={{ background: bg, color: textOn(bg) }}>
      <span className="opacity-80">{seatLabel(player)}</span> {player.name}
    </span>
  );
}

/** Small colored dot + name, for inline text on white. */
export function PlayerName({ player }: { player: Player }) {
  return (
    <span className="inline-flex items-center gap-1 font-extrabold">
      <span className="inline-block h-3 w-3 rounded-full border-2 border-ink" style={{ background: playerColor(player) }} aria-hidden />
      {player.name}
    </span>
  );
}

export function Outlined({
  children,
  className = '',
  inverse = false,
  as: Tag = 'span',
  style,
  id,
}: {
  children: ReactNode;
  className?: string;
  inverse?: boolean;
  as?: 'span' | 'h1' | 'h2' | 'div';
  style?: CSSProperties;
  id?: string;
}) {
  return (
    <Tag id={id} className={`outlined ${inverse ? 'outlined-inverse' : ''} ${className}`} style={style}>
      {children}
    </Tag>
  );
}

/** Avatar circle: player's starter render with a ring in the player's color. */
export function Avatar({
  player,
  dex,
  name,
  size = 56,
  ring = 5,
}: {
  player: Player;
  dex: number;
  name: string;
  size?: number;
  ring?: number;
}) {
  return (
    <span
      className="flex flex-none items-center justify-center overflow-hidden rounded-full bg-white"
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 ${ring}px ${playerColor(player)}` }}
    >
      <Render dex={dex} name={name} type={NEUTRAL_TYPE} size={size * 0.78} />
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  outlinedTitle = false,
  above = false,
}: {
  title: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  wide?: boolean;
  outlinedTitle?: boolean;
  /** Stack above the battle screen. */
  above?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-autofocus], button:not(:disabled), input, select');
    el?.focus();
  }, []);
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={`fixed inset-0 ${above ? 'z-[70]' : 'z-40'} flex items-end justify-center bg-ink/55 p-2 sm:items-center sm:p-4`} role="presentation">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`card-strong pop flex max-h-[92dvh] w-full flex-col ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-3">
          {outlinedTitle ? (
            <Outlined as="h2" id="modal-title" className="text-[32px]">
              {title}
            </Outlined>
          ) : (
            <h2 id="modal-title" className="font-display text-[22px] font-bold">
              {title}
            </h2>
          )}
          {onClose && (
            <button className="btn btn-sm" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </div>
  );
}

export function HpBar({ hp, max }: { hp: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const color = pct < 20 ? 'var(--red)' : pct < 50 ? 'var(--yellow)' : 'var(--hp-green)';
  return (
    <div className="flex items-center gap-3">
      <div
        className="hp-track flex-1"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={hp}
        aria-label="HP"
      >
        <div className="hp-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-display text-[16px] leading-none font-bold whitespace-nowrap sm:text-[22px]">
        {hp} / {max}
      </span>
    </div>
  );
}
