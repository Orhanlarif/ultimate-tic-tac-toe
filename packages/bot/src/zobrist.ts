/**
 * Deterministic dual-uint32 Zobrist keys for UTTT search positions.
 *
 * Keys live in flat `Uint32Array`s and are consumed as scalar `lo`/`hi` pairs
 * so that `make`/`unmake` stay allocation-free on the search hot path.
 */

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return (r ^ (r >>> 14)) >>> 0;
  };
}

export interface HashPair {
  lo: number;
  hi: number;
}

const nextLo = mulberry32(0x55545454 ^ 0x5f3759df);
const nextHi = mulberry32((0x55545454 ^ 0x5f3759df) ^ 0xa5a5a5a5);

function fill(length: number): [Uint32Array, Uint32Array] {
  const lo = new Uint32Array(length);
  const hi = new Uint32Array(length);
  for (let i = 0; i < length; i++) {
    lo[i] = nextLo();
    hi[i] = nextHi();
  }
  return [lo, hi];
}

/** Index: (board * 9 + cell) * 2 + side */
export const [PIECE_LO, PIECE_HI] = fill(9 * 9 * 2);
/** Index: board * 3 + kind, where kind is 0 = X, 1 = O, 2 = draw */
export const [WINNER_LO, WINNER_HI] = fill(9 * 3);
/** Index: 0-8 for a constrained board, 9 for "any board". */
export const [ACTIVE_LO, ACTIVE_HI] = fill(10);

const sideKey = { lo: nextLo(), hi: nextHi() };
export const SIDE_LO = sideKey.lo;
export const SIDE_HI = sideKey.hi;

export function pieceIndex(board: number, cell: number, side: number): number {
  return (board * 9 + cell) * 2 + side;
}

export function hashActiveIndex(activeBoard: number | null): number {
  return activeBoard === null ? 9 : activeBoard;
}

export function hashEqual(a: HashPair, b: HashPair): boolean {
  return a.lo === b.lo && a.hi === b.hi;
}
