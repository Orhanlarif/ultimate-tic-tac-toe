import type { BoardIndex, CellIndex, GameState, Move, Player } from "@uttt/game-engine";
import {
  ACTIVE_HI,
  ACTIVE_LO,
  hashActiveIndex,
  hashEqual,
  PIECE_HI,
  PIECE_LO,
  pieceIndex,
  SIDE_HI,
  SIDE_LO,
  WINNER_HI,
  WINNER_LO,
  type HashPair,
} from "./zobrist.js";
import { playerToSide, type Side } from "./types.js";

export const WIN_LINES: readonly [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** 9-bit masks for the eight win lines (bit i = cell i). */
export const LINE_MASKS: readonly number[] = WIN_LINES.map(
  ([a, b, c]) => (1 << a) | (1 << b) | (1 << c),
);

export const FULL_MASK = 0x1ff;

/** popcount for 9-bit masks. */
export const POPCOUNT = buildPopcount();
/** IS_WIN[mask] = 1 when the mask contains a full line. */
export const IS_WIN = buildWinTable();

/**
 * Every legal move is one of 81 (board, cell) pairs, so the search can hand out
 * shared immutable instances instead of allocating a fresh object per node.
 * Callers must treat moves as read-only.
 */
export const MOVE_TABLE: readonly Move[] = buildMoveTable();

function buildMoveTable(): Move[] {
  const out: Move[] = [];
  for (let b = 0; b < 9; b++) {
    for (let c = 0; c < 9; c++) {
      out.push(Object.freeze({ board: b as BoardIndex, cell: c as CellIndex }));
    }
  }
  return out;
}

export function moveOf(board: number, cell: number): Move {
  return MOVE_TABLE[board * 9 + cell]!;
}

function buildPopcount(): Uint8Array {
  const t = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    let n = 0;
    for (let b = 0; b < 9; b++) if (i & (1 << b)) n += 1;
    t[i] = n;
  }
  return t;
}

function buildWinTable(): Uint8Array {
  const t = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    for (const line of LINE_MASKS) {
      if ((i & line) === line) {
        t[i] = 1;
        break;
      }
    }
  }
  return t;
}

export interface ThreatCounts {
  twos: number;
  ones: number;
  forks: number;
}

/**
 * Threat counts for every (mine, theirs) occupancy pair, packed as
 * `twos | ones << 4 | forks << 8`. Both masks are 9 bits, so the whole table is
 * 512 KB and turns threat counting into a single indexed load — by far the
 * hottest operation in both evaluation and move classification.
 */
const THREAT_TABLE = buildThreatTable();

function buildThreatTable(): Uint16Array {
  const table = new Uint16Array(512 * 512);
  for (let mine = 0; mine < 512; mine++) {
    for (let theirs = 0; theirs < 512; theirs++) {
      if (mine & theirs) continue;
      let twos = 0;
      let ones = 0;
      let threatBits = 0;
      for (let i = 0; i < 8; i++) {
        const line = LINE_MASKS[i]!;
        if (theirs & line) continue;
        const n = POPCOUNT[mine & line]!;
        if (n === 2) {
          twos += 1;
          threatBits |= line & ~mine;
        } else if (n === 1) {
          ones += 1;
        }
      }
      const distinct = POPCOUNT[threatBits & FULL_MASK]!;
      const forks = distinct >= 2 ? distinct : 0;
      table[(mine << 9) | theirs] = twos | (ones << 4) | (forks << 8);
    }
  }
  return table;
}

/** Packed threat counts; decode with `twosOf` / `onesOf` / `forksOf`. */
export function threatBits(mine: number, theirs: number): number {
  return THREAT_TABLE[(mine << 9) | theirs]!;
}

export function twosOf(packed: number): number {
  return packed & 15;
}

export function onesOf(packed: number): number {
  return (packed >> 4) & 15;
}

export function forksOf(packed: number): number {
  return (packed >> 8) & 15;
}

/**
 * Object-shaped view of `threatBits` for callers outside the hot path.
 * `mine`/`theirs` are occupancy masks; empty squares are the rest.
 */
export function threatsFromBits(
  mine: number,
  theirs: number,
  out: ThreatCounts,
): ThreatCounts {
  const packed = threatBits(mine, theirs);
  out.twos = packed & 15;
  out.ones = (packed >> 4) & 15;
  out.forks = (packed >> 8) & 15;
  return out;
}

/** 0 empty, 1 X, 2 O */
export type CellVal = 0 | 1 | 2;
/** 0 open, 1 X, 2 O, 3 draw */
export type WinnerVal = 0 | 1 | 2 | 3;

/** A game has at most 81 plies, so the undo stack never needs to grow. */
const UNDO_CAPACITY = 96;
const UNDO_STRIDE = 8;
const U_BOARD = 0;
const U_CELL = 1;
const U_SIDE = 2;
const U_ACTIVE = 3;
const U_STATUS = 4;
const U_WINNER = 5;
const U_WON_BOARD = 6;
const U_EMPTIED = 7;

/**
 * Compact mutable search position. Avoids cloning full GameState / move history.
 *
 * The Zobrist hash is kept as two scalar uint32 halves rather than an object so
 * that `make`/`unmake` allocate nothing.
 */
export class SearchState {
  cells: Uint8Array;
  winners: Uint8Array;
  /** Per-board 9-bit occupancy masks, index 0 = X, 1 = O. */
  bits: [Uint16Array, Uint16Array];
  /** Meta-board 9-bit masks: X wins, O wins, drawn boards. */
  metaBits: [number, number, number];
  side: Side;
  active: number; // 0-8 or 9 for any
  status: 0 | 1 | 2; // in_progress, won, draw
  winner: WinnerVal;
  emptyCount: number;
  hashLo: number;
  hashHi: number;
  private undoMeta: Int32Array;
  private undoHash: Uint32Array;
  private undoTop = 0;

  constructor(source: GameState) {
    this.cells = new Uint8Array(81);
    this.winners = new Uint8Array(9);
    this.bits = [new Uint16Array(9), new Uint16Array(9)];
    this.metaBits = [0, 0, 0];
    this.undoMeta = new Int32Array(UNDO_CAPACITY * UNDO_STRIDE);
    this.undoHash = new Uint32Array(UNDO_CAPACITY * 2);
    for (let b = 0; b < 9; b++) {
      const board = source.boards[b]!;
      for (let c = 0; c < 9; c++) {
        const v = board[c];
        this.cells[b * 9 + c] = v === "X" ? 1 : v === "O" ? 2 : 0;
        if (v === "X") this.bits[0][b]! |= 1 << c;
        else if (v === "O") this.bits[1][b]! |= 1 << c;
      }
      const w = source.boardWinners[b];
      this.winners[b] = w === "X" ? 1 : w === "O" ? 2 : w === "draw" ? 3 : 0;
      if (w === "X") this.metaBits[0] |= 1 << b;
      else if (w === "O") this.metaBits[1] |= 1 << b;
      else if (w === "draw") this.metaBits[2] |= 1 << b;
    }
    this.side = playerToSide(source.currentPlayer);
    this.active = hashActiveIndex(source.activeBoard);
    this.status =
      source.status === "won" ? 1 : source.status === "draw" ? 2 : 0;
    this.winner =
      source.winner === "X" ? 1 : source.winner === "O" ? 2 : 0;
    this.emptyCount = countPlayableEmpties(this.cells, this.winners);
    this.hashLo = 0;
    this.hashHi = 0;
    recomputeHashInto(this);
  }

  /** Object view of the hash; allocates, so avoid it inside the search. */
  get hash(): HashPair {
    return { lo: this.hashLo, hi: this.hashHi };
  }

  clone(): SearchState {
    const copy = Object.create(SearchState.prototype) as SearchState;
    copy.cells = this.cells.slice();
    copy.winners = this.winners.slice();
    copy.bits = [this.bits[0].slice(), this.bits[1].slice()];
    copy.metaBits = [this.metaBits[0], this.metaBits[1], this.metaBits[2]];
    copy.side = this.side;
    copy.active = this.active;
    copy.status = this.status;
    copy.winner = this.winner;
    copy.emptyCount = this.emptyCount;
    copy.hashLo = this.hashLo;
    copy.hashHi = this.hashHi;
    copy.undoMeta = new Int32Array(UNDO_CAPACITY * UNDO_STRIDE);
    copy.undoHash = new Uint32Array(UNDO_CAPACITY * 2);
    copy.undoTop = 0;
    return copy;
  }

  currentPlayer(): Player {
    return this.side === 0 ? "X" : "O";
  }

  collectMoves(out: Move[]): number {
    out.length = 0;
    if (this.status !== 0) return 0;

    if (this.active !== 9) {
      appendBoardMoves(this, this.active, out);
    } else {
      for (let b = 0; b < 9; b++) {
        if (this.winners[b] === 0) appendBoardMoves(this, b, out);
      }
    }
    return out.length;
  }

  make(move: Move): boolean {
    if (this.status !== 0) return false;
    const board = move.board;
    const cell = move.cell;
    if (this.winners[board] !== 0) return false;
    if (this.active !== 9 && this.active !== board) return false;
    const idx = board * 9 + cell;
    if (this.cells[idx] !== 0) return false;

    const top = this.undoTop;
    const base = top * UNDO_STRIDE;
    const meta = this.undoMeta;
    meta[base + U_BOARD] = board;
    meta[base + U_CELL] = cell;
    meta[base + U_SIDE] = this.side;
    meta[base + U_ACTIVE] = this.active;
    meta[base + U_STATUS] = this.status;
    meta[base + U_WINNER] = this.winner;
    this.undoHash[top * 2] = this.hashLo;
    this.undoHash[top * 2 + 1] = this.hashHi;

    const side = this.side;
    this.cells[idx] = (side + 1) as CellVal;
    this.bits[side][board]! |= 1 << cell;
    const pk = pieceIndex(board, cell, side);
    this.hashLo = (this.hashLo ^ PIECE_LO[pk]! ^ ACTIVE_LO[this.active]!) >>> 0;
    this.hashHi = (this.hashHi ^ PIECE_HI[pk]! ^ ACTIVE_HI[this.active]!) >>> 0;
    this.emptyCount -= 1;

    let wonBoard = -1;
    let emptiedOnWin = 0;
    // Only the side that just moved can have completed a line here.
    const myBits = this.bits[side][board]!;
    const oppBits = this.bits[(1 - side) as Side][board]!;
    const local: WinnerVal = IS_WIN[myBits]
      ? ((side + 1) as WinnerVal)
      : (myBits | oppBits) === FULL_MASK
        ? 3
        : 0;
    if (local !== 0) {
      const metaIdx = local === 3 ? 2 : local - 1;
      this.winners[board] = local;
      this.metaBits[metaIdx] = (this.metaBits[metaIdx] ?? 0) | (1 << board);
      const wk = board * 3 + metaIdx;
      this.hashLo = (this.hashLo ^ WINNER_LO[wk]!) >>> 0;
      this.hashHi = (this.hashHi ^ WINNER_HI[wk]!) >>> 0;
      wonBoard = board;
      for (let c = 0; c < 9; c++) {
        if (this.cells[board * 9 + c] === 0) emptiedOnWin += 1;
      }
      this.emptyCount -= emptiedOnWin;
    }

    const metaResult: WinnerVal = IS_WIN[this.metaBits[0]!]
      ? 1
      : IS_WIN[this.metaBits[1]!]
        ? 2
        : (this.metaBits[0] | this.metaBits[1] | this.metaBits[2]) === FULL_MASK
          ? 3
          : 0;
    if (metaResult === 1 || metaResult === 2) {
      this.status = 1;
      this.winner = metaResult;
      this.active = 9;
    } else if (metaResult === 3) {
      this.status = 2;
      this.winner = 0;
      this.active = 9;
    } else {
      if (this.winners[cell] === 0) this.active = cell;
      else this.active = 9;
      this.side = (1 - side) as Side;
      this.hashLo = (this.hashLo ^ SIDE_LO) >>> 0;
      this.hashHi = (this.hashHi ^ SIDE_HI) >>> 0;
    }
    this.hashLo = (this.hashLo ^ ACTIVE_LO[this.active]!) >>> 0;
    this.hashHi = (this.hashHi ^ ACTIVE_HI[this.active]!) >>> 0;

    meta[base + U_WON_BOARD] = wonBoard;
    meta[base + U_EMPTIED] = emptiedOnWin;
    this.undoTop = top + 1;
    return true;
  }

  unmake(): void {
    if (this.undoTop === 0) return;
    const top = this.undoTop - 1;
    this.undoTop = top;
    const base = top * UNDO_STRIDE;
    const meta = this.undoMeta;

    const wonBoard = meta[base + U_WON_BOARD]!;
    if (wonBoard >= 0) {
      const prevLocal = this.winners[wonBoard]!;
      const metaIdx = prevLocal === 3 ? 2 : prevLocal - 1;
      this.metaBits[metaIdx] = (this.metaBits[metaIdx] ?? 0) & ~(1 << wonBoard);
      this.winners[wonBoard] = 0;
      this.emptyCount += meta[base + U_EMPTIED]!;
    }

    const board = meta[base + U_BOARD]!;
    const cell = meta[base + U_CELL]!;
    const prevSide = meta[base + U_SIDE]! as Side;
    this.cells[board * 9 + cell] = 0;
    this.bits[prevSide][board]! &= ~(1 << cell);
    this.emptyCount += 1;
    this.side = prevSide;
    this.active = meta[base + U_ACTIVE]!;
    this.status = meta[base + U_STATUS]! as 0 | 1 | 2;
    this.winner = meta[base + U_WINNER]! as WinnerVal;
    this.hashLo = this.undoHash[top * 2]!;
    this.hashHi = this.undoHash[top * 2 + 1]!;
  }
}

function appendBoardMoves(state: SearchState, board: number, out: Move[]): void {
  let free = (state.bits[0][board]! | state.bits[1][board]!) ^ FULL_MASK;
  const base = board * 9;
  while (free !== 0) {
    const lsb = free & -free;
    out.push(MOVE_TABLE[base + (31 - Math.clz32(lsb))]!);
    free ^= lsb;
  }
}

function countPlayableEmpties(cells: Uint8Array, winners: Uint8Array): number {
  let n = 0;
  for (let b = 0; b < 9; b++) {
    if (winners[b] !== 0) continue;
    const base = b * 9;
    for (let c = 0; c < 9; c++) {
      if (cells[base + c] === 0) n += 1;
    }
  }
  return n;
}

export function localWinner(cells: Uint8Array, board: number): WinnerVal {
  const base = board * 9;
  for (const [a, b, c] of WIN_LINES) {
    const v = cells[base + a]!;
    if (v !== 0 && v === cells[base + b]! && v === cells[base + c]!) {
      return v as WinnerVal;
    }
  }
  for (let c = 0; c < 9; c++) {
    if (cells[base + c] === 0) return 0;
  }
  return 3;
}

export function metaWinner(winners: Uint8Array): WinnerVal {
  for (const [a, b, c] of WIN_LINES) {
    const v = winners[a]!;
    if ((v === 1 || v === 2) && v === winners[b]! && v === winners[c]!) {
      return v as WinnerVal;
    }
  }
  for (let i = 0; i < 9; i++) {
    if (winners[i] === 0) return 0;
  }
  return 3;
}

function recomputeHashInto(state: SearchState): void {
  let lo = 0;
  let hi = 0;
  for (let b = 0; b < 9; b++) {
    for (let c = 0; c < 9; c++) {
      const v = state.cells[b * 9 + c]!;
      if (v !== 0) {
        const k = pieceIndex(b, c, v - 1);
        lo = (lo ^ PIECE_LO[k]!) >>> 0;
        hi = (hi ^ PIECE_HI[k]!) >>> 0;
      }
    }
    const w = state.winners[b]!;
    if (w !== 0) {
      const k = b * 3 + (w === 3 ? 2 : w - 1);
      lo = (lo ^ WINNER_LO[k]!) >>> 0;
      hi = (hi ^ WINNER_HI[k]!) >>> 0;
    }
  }
  lo = (lo ^ ACTIVE_LO[state.active]!) >>> 0;
  hi = (hi ^ ACTIVE_HI[state.active]!) >>> 0;
  if (state.side === 1) {
    lo = (lo ^ SIDE_LO) >>> 0;
    hi = (hi ^ SIDE_HI) >>> 0;
  }
  state.hashLo = lo;
  state.hashHi = hi;
}

export function computeHash(state: SearchState): HashPair {
  const lo = state.hashLo;
  const hi = state.hashHi;
  recomputeHashInto(state);
  const fresh = { lo: state.hashLo, hi: state.hashHi };
  state.hashLo = lo;
  state.hashHi = hi;
  return fresh;
}

export function hashesMatch(a: HashPair, b: HashPair): boolean {
  return hashEqual(a, b);
}

export function lineThreatCount(
  values: ArrayLike<number>,
  player: number,
  openValue = 0,
): { twos: number; ones: number; forks: number } {
  let twos = 0;
  let ones = 0;
  const threatSquares = new Map<number, number>();
  for (const [a, b, c] of WIN_LINES) {
    const cells = [values[a]!, values[b]!, values[c]!];
    let mine = 0;
    let empty = 0;
    let emptyIdx = -1;
    let theirs = 0;
    for (let i = 0; i < 3; i++) {
      const v = cells[i]!;
      if (v === player) mine += 1;
      else if (v === openValue) {
        empty += 1;
        emptyIdx = [a, b, c][i]!;
      } else theirs += 1;
    }
    if (theirs > 0) continue;
    if (mine === 2 && empty === 1) {
      twos += 1;
      threatSquares.set(emptyIdx, (threatSquares.get(emptyIdx) ?? 0) + 1);
    } else if (mine === 1 && empty === 2) {
      ones += 1;
    }
  }
  const forks = threatSquares.size >= 2 ? threatSquares.size : 0;
  return { twos, ones, forks };
}
