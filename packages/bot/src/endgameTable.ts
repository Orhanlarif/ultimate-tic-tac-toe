import type { HashPair } from "./zobrist.js";

const EMPTY = -1;
const MAX_DISTANCE = 127;

/**
 * Transposition table for proven endgame results.
 *
 * Values are stored relative to the side to move, so entries stay valid no
 * matter which seat the bot is searching for, and distances are stored
 * relative to the node rather than the root.
 */
export class EndgameTable {
  readonly size: number;
  private readonly mask: number;
  private readonly keyLo: Uint32Array;
  private readonly keyHi: Uint32Array;
  private readonly data: Int16Array;
  hits = 0;
  stores = 0;

  constructor(sizePower = 18) {
    this.size = 1 << sizePower;
    this.mask = this.size - 1;
    this.keyLo = new Uint32Array(this.size);
    this.keyHi = new Uint32Array(this.size);
    this.data = new Int16Array(this.size).fill(EMPTY);
  }

  clear(): void {
    this.keyLo.fill(0);
    this.keyHi.fill(0);
    this.data.fill(EMPTY);
    this.hits = 0;
    this.stores = 0;
  }

  /** Returns encoded value or EMPTY. Decode with `stmOutcome` / `stmDistance`. */
  probeAt(lo: number, hi: number): number {
    const idx = lo & this.mask;
    if (this.keyLo[idx] !== lo || this.keyHi[idx] !== hi) return EMPTY;
    const value = this.data[idx]!;
    if (value !== EMPTY) this.hits += 1;
    return value;
  }

  storeAt(lo: number, hi: number, outcomeStm: -1 | 0 | 1, distance: number): void {
    if (distance > MAX_DISTANCE || distance < 0) return;
    const idx = lo & this.mask;
    this.keyLo[idx] = lo;
    this.keyHi[idx] = hi;
    this.data[idx] = (outcomeStm + 1) * 128 + distance;
    this.stores += 1;
  }

  probe(hash: HashPair): number {
    return this.probeAt(hash.lo, hash.hi);
  }

  store(hash: HashPair, outcomeStm: -1 | 0 | 1, distance: number): void {
    this.storeAt(hash.lo, hash.hi, outcomeStm, distance);
  }
}

export const ENDGAME_EMPTY = EMPTY;

export function stmOutcome(value: number): -1 | 0 | 1 {
  return ((value >> 7) - 1) as -1 | 0 | 1;
}

export function stmDistance(value: number): number {
  return value & 127;
}
