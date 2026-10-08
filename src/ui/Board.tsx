import type { ReactNode } from 'react';
import { CONFIG } from '../data/config';
import { LEGENDARY_BORDER, NEUTRAL_TYPE, SPECIAL_TILE_COLORS, STARTERS, TYPES } from '../data/theme';
import { BOARD_SIZE, isLegendary, isProperty, tileFee, tileForm, tilePrice } from '../engine/selectors';
import type { GameState } from '../engine/types';
import { Render } from './common';
import { money, playerColor, seatLabel, textOn } from './format';
import { TileIcon } from './icons';

// ── Geometry (all in % of board width = cqw) ────────────────────────────────

const SIDE = BOARD_SIZE / 4; // tiles per side, not counting the next corner
const CELLS = SIDE + 1; // 8 cells per row
const PAD = 1.2;
const GAP = 1;
const TILE = (100 - 2 * PAD - (CELLS - 1) * GAP) / CELLS;
const TOKEN = 5;
/** Center line of the token lane just inside the ring. */
const LANE = PAD + TILE + GAP + 0.4 + TOKEN / 2;
const FAN = 3.2; // spacing between tokens sharing a tile

const cellCenter = (c: number) => PAD + c * (TILE + GAP) + TILE / 2;

/** Grid cell (0-based row/col) for board index i. 0 = bottom-right, clockwise. */
function cell(i: number): { row: number; col: number } {
  if (i <= SIDE) return { row: SIDE, col: SIDE - i };
  if (i <= 2 * SIDE) return { row: SIDE - (i - SIDE), col: 0 };
  if (i <= 3 * SIDE) return { row: 0, col: i - 2 * SIDE };
  return { row: i - 3 * SIDE, col: SIDE };
}

/** Where the k-th of n tokens on tile i stands: in the inner lane, or inside corner tiles. */
function tokenSpot(i: number, k: number, n: number): { x: number; y: number } {
  const { row, col } = cell(i);
  const off = (k - (n - 1) / 2) * FAN;
  const corner = (row === 0 || row === SIDE) && (col === 0 || col === SIDE);
  if (corner) return { x: cellCenter(col) + off * 0.75, y: cellCenter(row) + TILE * 0.2 };
  if (row === SIDE) return { x: cellCenter(col) + off, y: 100 - LANE };
  if (row === 0) return { x: cellCenter(col) + off, y: LANE };
  if (col === 0) return { x: LANE, y: cellCenter(row) + off };
  return { x: 100 - LANE, y: cellCenter(row) + off };
}

// ── Board ────────────────────────────────────────────────────────────────────

export function Board({
  game,
  shownPos,
  onTile,
  stage,
}: {
  game: GameState;
  shownPos: number[];
  onTile: (i: number) => void;
  stage: ReactNode;
}) {
  const alive = game.players.filter((p) => !p.bankrupt);
  return (
    <div className="board-wrap">
      <div className="board" role="group" aria-label="Game board">
        {game.board.map((def, i) => {
          const { row, col } = cell(i);
          const t = game.tiles[i];
          const owner = t.owner !== null ? game.players[t.owner] : null;
          const style = { gridRow: row + 1, gridColumn: col + 1 };

          if (!isProperty(game, i)) {
            const bg = SPECIAL_TILE_COLORS[def.kind]!;
            const corner = (row === 0 || row === SIDE) && (col === 0 || col === SIDE);
            const isGo = def.kind === 'go';
            return (
              <button
                key={i}
                className={`tile tile-special ${corner ? 'tile-corner' : ''}`}
                style={{ ...style, background: bg, color: textOn(bg) }}
                aria-label={def.name}
                onClick={() => onTile(i)}
              >
                <TileIcon kind={def.kind} />
                <span className="tile-label long">{def.name}</span>
                {isGo && <span className="tile-label long opacity-80">Collect {money(CONFIG.goPayout)}</span>}
              </button>
            );
          }

          const form = tileForm(game, i);
          const type = def.type!;
          const legendary = isLegendary(game, i);
          const ownerColor = owner ? playerColor(owner) : null;
          const fee = owner ? tileFee(game, i) : tilePrice(game, i);
          const label = `${form.name}, ${TYPES[type].name}${legendary ? ', legendary' : ''}, ${
            owner ? `owned by ${owner.name}, level ${t.level}, fee ${money(fee)}` : `unowned, price ${money(fee)}`
          }`;
          return (
            <button
              key={i}
              className="tile dots"
              style={{
                ...style,
                backgroundColor: TYPES[type].color,
                borderColor: legendary ? LEGENDARY_BORDER : '#fff',
                boxShadow: ownerColor
                  ? `0 0 0 0.45cqw ${ownerColor}, 0 0.9cqw 0 rgba(19,28,63,.3)`
                  : undefined,
              }}
              aria-label={label}
              onClick={() => onTile(i)}
            >
              <div className="tile-img-area">
                <Render dex={form.dex} name={form.name} type={type} className="tile-img" />
              </div>
              <div className="tile-strip">
                <span className="tile-name">{form.name}</span>
                <span className="tile-fee">{money(fee)}</span>
              </div>
              {legendary ? (
                <span className="tile-lv legend" aria-hidden>
                  ★
                </span>
              ) : (
                owner && (
                  <span className="tile-lv" aria-hidden>
                    Lv {t.level}
                  </span>
                )
              )}
              {owner && (
                <span className="tile-owner" style={{ background: ownerColor!, color: textOn(ownerColor!) }} aria-hidden>
                  {seatLabel(owner)}
                </span>
              )}
            </button>
          );
        })}

        <div className="stage">{stage}</div>
      </div>

      {/* Tokens stand in the inner lane next to their tile (inside the tile for corners). */}
      {alive.map((p) => {
        const here = alive.filter((q) => shownPos[q.id] === shownPos[p.id]);
        const k = here.findIndex((q) => q.id === p.id);
        const { x, y } = tokenSpot(shownPos[p.id], k, here.length);
        const color = playerColor(p);
        const f = STARTERS[p.starter];
        return (
          <span
            key={p.id}
            className={`token ${p.id === game.current && game.phase !== 'gameOver' ? 'token-current' : ''}`}
            style={{ left: `${x}cqw`, top: `${y}cqw`, borderColor: color }}
            aria-hidden
          >
            <Render dex={f.dex} name={f.name} type={NEUTRAL_TYPE} />
            <span className="token-tag" style={{ background: color, color: textOn(color) }}>
              {seatLabel(p)}
            </span>
          </span>
        );
      })}
    </div>
  );
}
