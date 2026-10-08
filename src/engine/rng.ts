// Seeded RNG (mulberry32). The state is a uint32 stored in GameState.rng.

function step(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

export function seedToState(seed: number): number {
  return (seed >>> 0) ^ 0x9e3779b9;
}

/** Holder that the reducer mutates while building the next state. */
export interface RngHolder {
  rng: number;
}

/** Float in [0, 1). Advances holder.rng. */
export function nextFloat(h: RngHolder): number {
  const [v, n] = step(h.rng);
  h.rng = n;
  return v;
}

/** Integer in [min, max] inclusive. Advances holder.rng. */
export function nextInt(h: RngHolder, min: number, max: number): number {
  return min + Math.floor(nextFloat(h) * (max - min + 1));
}

/** In-place Fisher-Yates shuffle. */
export function shuffle<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(h, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deterministic float in [0, 1) derived from the RNG state WITHOUT advancing it.
 * Bots use this so their choices are reproducible but don't consume game randomness.
 */
export function peekFloat(rngState: number, salt: number): number {
  return step((rngState ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0)[0];
}
