import { BALLS, type ThrowBall, type TileKind } from '../data/theme';

/** Simple stroke icons for special tiles. They inherit currentColor. */
export function TileIcon({ kind, className }: { kind: TileKind; className?: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'go':
      // Arrow pointing the way you move from the start tile, with a coin.
      return (
        <svg {...common}>
          <path d="M20 12H5" />
          <path d="M10 6l-6 6 6 6" />
          <circle cx="18" cy="5" r="2.5" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common}>
          <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7" />
          <path d="M12 17.2h.01" />
        </svg>
      );
    case 'hideout':
      return (
        <svg {...common}>
          <rect x="4" y="10.5" width="16" height="11" rx="2.5" />
          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
          <path d="M12 15v2.5" />
        </svg>
      );
    case 'goToHideout':
      return (
        <svg {...common}>
          <path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <path d="M3 12h11" />
          <path d="M10 8l4 4-4 4" />
        </svg>
      );
    case 'ambush':
      return (
        <svg {...common}>
          <path d="M12 3L2.5 20h19L12 3z" />
          <path d="M12 9.5v5" />
          <path d="M12 17.5h.01" />
        </svg>
      );
    case 'safari':
      return (
        <svg {...common}>
          <path d="M12 21v-6" />
          <path d="M12 15c-4.5 0-7-2.5-7-6 0-3.5 3-6 7-6s7 2.5 7 6c0 3.5-2.5 6-7 6z" />
          <path d="M12 15l-3-3M12 12.5l2.5-2.5" />
        </svg>
      );
    case 'bonus':
      return (
        <svg {...common}>
          <path d="M12 20.5s-8-4.6-8-10.5a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.9-8 10.5-8 10.5z" />
          <path d="M12 9.5v5M9.5 12h5" />
        </svg>
      );
    default:
      return null;
  }
}

/** Two-tone ball, drawn in code: colored top, white bottom, center band and button, ink outline. */
export function BallIcon({ ball, size = 24, className = '' }: { ball: ThrowBall; size?: number | string; className?: string }) {
  const { top, accent, name } = BALLS[ball];
  return (
    // Decorative: every use sits next to the ball name in text.
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden data-ball={name}>
      <path d="M2 16a14 14 0 0 1 28 0z" fill={top} />
      <path d="M2 16a14 14 0 0 0 28 0z" fill="#fff" />
      {ball === 'great' && (
        <>
          <path d="M7 9.5l4 3.5M25 9.5l-4 3.5" stroke={accent} strokeWidth="3.2" strokeLinecap="round" />
        </>
      )}
      {ball === 'ultra' && <path d="M9 4.5v7M23 4.5v7" stroke={accent} strokeWidth="3.4" strokeLinecap="round" />}
      {ball === 'master' && (
        <>
          <circle cx="9.5" cy="10" r="2.6" fill={accent} />
          <circle cx="22.5" cy="10" r="2.6" fill={accent} />
          <text x="16" y="12.2" textAnchor="middle" fontSize="7" fontWeight="900" fill="#fff" fontFamily="sans-serif">
            M
          </text>
        </>
      )}
      <path d="M2 16h28" stroke="#131C3F" strokeWidth="2.6" />
      <circle cx="16" cy="16" r="4.6" fill="#fff" stroke="#131C3F" strokeWidth="2.4" />
      <circle cx="16" cy="16" r="14" fill="none" stroke="#131C3F" strokeWidth="2" />
    </svg>
  );
}
