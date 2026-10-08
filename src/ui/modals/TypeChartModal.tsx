import { CONFIG } from '../../data/config';
import { BOARD_TYPES, MOVES, NEUTRAL_TYPE, TYPES, WORDS, type TypeId } from '../../data/theme';
import { typeMultiplier } from '../../engine/selectors';
import { Modal, TypeChip } from '../common';
import { shade } from '../format';

const ALL_TYPES: TypeId[] = [...BOARD_TYPES, NEUTRAL_TYPE];

/** Every matchup comes from the engine's typeMultiplier, so the chart always matches battles. */
function cellStyle(m: number) {
  if (m > 1) return { background: 'var(--hp-green)', color: 'var(--ink)' };
  if (m < 1) return { background: 'var(--red)', color: '#fff' };
  return { background: 'transparent', color: 'var(--ink-soft)' };
}
const cellText = (m: number) => (m > 1 ? `×${m}` : m < 1 ? (m === 0.5 ? '×½' : `×${m}`) : '·');

export function TypeChartModal({ onClose, above = false }: { onClose: () => void; above?: boolean }) {
  const strongVs = (t: TypeId) => ALL_TYPES.filter((d) => typeMultiplier(t, d) > 1);
  const weakVs = (t: TypeId) => ALL_TYPES.filter((d) => typeMultiplier(t, d) < 1);

  return (
    <Modal title="Type chart" onClose={onClose} wide above={above}>
      <p className="mb-3 text-[15px] text-ink-soft">
        How much damage a <b className="text-ink">type move</b> does. Rows attack, columns defend.
      </p>

      {/* Grid: tablet and up */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-separate border-spacing-1 text-center">
          <thead>
            <tr>
              <th className="text-[12px] font-extrabold text-ink-soft">
                Attack ↓ <br /> Defend →
              </th>
              {ALL_TYPES.map((d) => (
                <th key={d} scope="col">
                  <span
                    className="chip w-full justify-center px-1 text-[12px]"
                    style={{ background: shade(TYPES[d].color) }}
                    title={TYPES[d].name}
                  >
                    {TYPES[d].short}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ALL_TYPES.map((a) => (
              <tr key={a}>
                <th scope="row" className="text-left">
                  <TypeChip type={a} className="text-[13px]" />
                </th>
                {ALL_TYPES.map((d) => {
                  const m = typeMultiplier(a, d);
                  return (
                    <td
                      key={d}
                      className="font-display h-9 rounded-lg border-2 border-ink/15 text-[15px] font-bold"
                      style={cellStyle(m)}
                      aria-label={`${TYPES[a].name} against ${TYPES[d].name}: ×${m}`}
                    >
                      {cellText(m)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* List: phones */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {ALL_TYPES.map((t) => {
          const strong = strongVs(t);
          const weak = weakVs(t);
          return (
            <li key={t} className="rounded-2xl border-[3px] border-ink p-2.5">
              <div className="flex items-center gap-2">
                <TypeChip type={t} className="text-[14px]" />
                <span className="text-[13px] font-extrabold text-ink-soft">{TYPES[t].move}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px]">
                <span className="w-24 font-extrabold">Strong ×{CONFIG.typeMultipliers.strong} vs</span>
                {strong.length ? strong.map((d) => <TypeChip key={d} type={d} />) : <span className="text-ink-soft">nothing</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px]">
                <span className="w-24 font-extrabold">Weak ×{CONFIG.typeMultipliers.weak} vs</span>
                {weak.length ? weak.map((d) => <TypeChip key={d} type={d} />) : <span className="text-ink-soft">nothing</span>}
              </div>
            </li>
          );
        })}
      </ul>

      <ul className="mt-4 flex flex-col gap-1 text-[14px] text-ink-soft">
        <li>
          • Anything involving <b className="text-ink">{TYPES[NEUTRAL_TYPE].name}</b> is ×1. Every {WORDS.starter.toLowerCase()} and{' '}
          {WORDS.grunt} is {TYPES[NEUTRAL_TYPE].name}.
        </li>
        <li>
          • <b className="text-ink">{MOVES.tackle}</b> ignores types.
        </li>
        <li>• If a type is strong against another, that type resists it back.</li>
      </ul>
    </Modal>
  );
}
