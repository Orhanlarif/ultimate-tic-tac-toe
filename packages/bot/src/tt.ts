import type { Move } from "@uttt/game-engine";
import { MATE } from "./constants.js";
import { MOVE_TABLE } from "./searchState.js";
import type { HashPair } from "./zobrist.js";

export const TT_EXACT = 0;
export const TT_LOWER = 1;
export const TT_UPPER = 2;

export interface TtProbe {
  depth: number;
  score: number;
  flag: 0 | 1 | 2;
  move: Move | null;
}

const NO_MOVE = 255;

/**
 * Typed-array transposition table with dual-uint32 key verification,
 * search generation/age and depth-preferred replacement.
 *
 * The search uses `probeAt`, which writes its result into `hit*` fields rather
 * than allocating a probe object per node.
 */
export class TranspositionTable {
  readonly size: number;
  private readonly mask: number;
  private readonly keyLo: Uint32Array;
  private readonly keyHi: Uint32Array;
  private readonly depth: Int16Array;
  private readonly score: Int32Array;
  private readonly flag: Uint8Array;
  private readonly move: Uint8Array;
  private readonly age: Uint16Array;
  private generation = 1;
  hits = 0;
  stores = 0;
  collisions = 0;
  private hitsAtSearchStart = 0;

  /** Result of the most recent successful `probeAt`. */
  hitDepth = 0;
  hitScore = 0;
  hitFlag: 0 | 1 | 2 = TT_EXACT;
  /** Packed board*9+cell, or -1 when the entry carries no move. */
  hitMoveCode = -1;

  constructor(sizePower = 18) {
    this.size = 1 << sizePower;
    this.mask = this.size - 1;
    this.keyLo = new Uint32Array(this.size);
    this.keyHi = new Uint32Array(this.size);
    this.depth = new Int16Array(this.size);
    this.score = new Int32Array(this.size);
    this.flag = new Uint8Array(this.size);
    this.move = new Uint8Array(this.size);
    this.age = new Uint16Array(this.size);
    this.move.fill(NO_MOVE);
  }

  clear(): void {
    this.keyLo.fill(0);
    this.keyHi.fill(0);
    this.depth.fill(0);
    this.score.fill(0);
    this.flag.fill(0);
    this.move.fill(NO_MOVE);
    this.age.fill(0);
    this.hits = 0;
    this.stores = 0;
    this.collisions = 0;
    this.hitsAtSearchStart = 0;
    this.generation = 1;
  }

  /** Call once per root search so age-based replacement can prefer fresh entries. */
  beginSearch(): void {
    this.generation = (this.generation + 1) & 0xffff || 1;
    this.hitsAtSearchStart = this.hits;
    this.stores = 0;
    this.collisions = 0;
  }

  hitsThisSearch(): number {
    return this.hits - this.hitsAtSearchStart;
  }

  /** Allocation-free probe; on true, read `hitDepth`/`hitScore`/`hitFlag`/`hitMoveCode`. */
  probeAt(lo: number, hi: number, ply: number): boolean {
    const idx = lo & this.mask;
    if (this.keyLo[idx] !== lo || this.keyHi[idx] !== hi) return false;
    if (this.age[idx] === 0) return false;
    this.hits += 1;
    this.hitDepth = this.depth[idx]!;
    this.hitScore = fromTtScore(this.score[idx]!, ply);
    this.hitFlag = this.flag[idx]! as 0 | 1 | 2;
    const code = this.move[idx]!;
    this.hitMoveCode = code === NO_MOVE || code > 80 ? -1 : code;
    return true;
  }

  probe(hash: HashPair, ply: number): TtProbe | null {
    if (!this.probeAt(hash.lo, hash.hi, ply)) return null;
    return {
      depth: this.hitDepth,
      score: this.hitScore,
      flag: this.hitFlag,
      move: this.hitMoveCode < 0 ? null : MOVE_TABLE[this.hitMoveCode]!,
    };
  }

  storeAt(
    lo: number,
    hi: number,
    depth: number,
    score: number,
    flag: 0 | 1 | 2,
    moveCode: number,
    ply: number,
  ): void {
    const idx = lo & this.mask;
    const existingAge = this.age[idx]!;
    const same =
      this.keyLo[idx] === lo && this.keyHi[idx] === hi && existingAge !== 0;

    if (same && this.depth[idx]! > depth && existingAge === this.generation) {
      return;
    }
    if (!same && existingAge === this.generation && this.depth[idx]! > depth) {
      this.collisions += 1;
      return;
    }
    if (!same && existingAge !== 0) this.collisions += 1;

    this.keyLo[idx] = lo;
    this.keyHi[idx] = hi;
    this.depth[idx] = depth;
    this.score[idx] = toTtScore(score, ply);
    this.flag[idx] = flag;
    this.move[idx] = moveCode < 0 || moveCode > 80 ? NO_MOVE : moveCode;
    this.age[idx] = this.generation;
    this.stores += 1;
  }

  store(
    hash: HashPair,
    depth: number,
    score: number,
    flag: 0 | 1 | 2,
    move: Move | null,
    ply: number,
  ): void {
    this.storeAt(
      hash.lo,
      hash.hi,
      depth,
      score,
      flag,
      move ? move.board * 9 + move.cell : -1,
      ply,
    );
  }
}

function toTtScore(score: number, ply: number): number {
  if (score >= MATE - 1000) return score + ply;
  if (score <= -MATE + 1000) return score - ply;
  return score;
}

function fromTtScore(score: number, ply: number): number {
  if (score >= MATE - 1000) return score - ply;
  if (score <= -MATE + 1000) return score + ply;
  return score;
}
