import type { Move } from "@uttt/game-engine";
import { MATE } from "./constants.js";
import {
  forksOf,
  FULL_MASK,
  IS_WIN,
  LINE_MASKS,
  onesOf,
  POPCOUNT,
  threatBits,
  twosOf,
  type SearchState,
} from "./searchState.js";

const POSITION_WEIGHTS = [1.15, 1, 1.15, 1, 1.35, 1, 1.15, 1, 1.15] as const;
const CELL_WEIGHTS = [1.1, 1, 1.1, 1, 1.35, 1, 1.1, 1, 1.1] as const;

/** Line index masks that pass through each board/cell position. */
const LINES_THROUGH: readonly number[] = buildLinesThrough();

/** BLOCKED_LINES[occupancy] = bitmask of the eight lines that occupancy kills. */
const BLOCKED_LINES: Uint8Array = buildBlockedLines();

function buildLinesThrough(): number[] {
  const out: number[] = [];
  for (let pos = 0; pos < 9; pos++) {
    let mask = 0;
    for (let i = 0; i < 8; i++) {
      if (LINE_MASKS[i]! & (1 << pos)) mask |= 1 << i;
    }
    out.push(mask);
  }
  return out;
}

function buildBlockedLines(): Uint8Array {
  const table = new Uint8Array(512);
  for (let occ = 0; occ < 512; occ++) {
    let mask = 0;
    for (let i = 0; i < 8; i++) {
      if (LINE_MASKS[i]! & occ) mask |= 1 << i;
    }
    table[occ] = mask;
  }
  return table;
}

/** Precomputed count of live lines through each position given blocked lines. */
function liveLinesThrough(pos: number, blockedLines: number): number {
  return POPCOUNT[LINES_THROUGH[pos]! & ~blockedLines & 0xff]!;
}

export const F_LOCAL_WIN = 1;
export const F_LOCAL_BLOCK = 2;
export const F_META_WIN = 4;
export const F_META_BLOCK = 8;
export const F_META_THREAT = 16;
export const F_FREE_SEND = 32;
export const F_FORCING = 64;
export const F_QUIET = 128;

export interface MoveFeatures {
  localWin: boolean;
  localBlock: boolean;
  metaWin: boolean;
  metaBlock: boolean;
  metaThreat: boolean;
  freeSend: boolean;
  forcing: boolean;
  quiet: boolean;
  orderBonus: number;
  /** Same information as the booleans, packed for typed-array storage. */
  flags: number;
}

export function emptyFeatures(): MoveFeatures {
  return {
    localWin: false,
    localBlock: false,
    metaWin: false,
    metaBlock: false,
    metaThreat: false,
    freeSend: false,
    forcing: false,
    quiet: false,
    orderBonus: 0,
    flags: 0,
  };
}

const scratchFeatures: MoveFeatures = emptyFeatures();

/** Evaluate position from `forSide` perspective (0=X, 1=O). Integer score. */
export function evaluate(state: SearchState, forSide: 0 | 1): number {
  if (state.status === 1) {
    return state.winner === forSide + 1 ? MATE : -MATE;
  }
  if (state.status === 2) return 0;

  const oppSide = (1 - forSide) as 0 | 1;
  const myBoards = state.bits[forSide];
  const oppBoards = state.bits[oppSide];
  const metaMine = state.metaBits[forSide]!;
  const metaOpp = state.metaBits[oppSide]!;
  const metaDraw = state.metaBits[2]!;

  // A meta line is dead for a player if it contains an enemy board or a draw.
  const deadForMe = BLOCKED_LINES[metaOpp | metaDraw]!;
  const deadForOpp = BLOCKED_LINES[metaMine | metaDraw]!;

  let score = 0;

  for (let b = 0; b < 9; b++) {
    const weight = POSITION_WEIGHTS[b]!;
    const myLive = liveLinesThrough(b, deadForMe);
    const oppLive = liveLinesThrough(b, deadForOpp);

    if (metaMine & (1 << b)) {
      score += (145 + myLive * 26) * weight;
      continue;
    }
    if (metaOpp & (1 << b)) {
      score -= (145 + oppLive * 26) * weight;
      continue;
    }
    if (metaDraw & (1 << b)) continue;

    // Contested board: worth less when neither side can use it any more.
    const relevance = myLive === 0 && oppLive === 0 ? 0.25 : 1;
    score +=
      localBoardScore(myBoards[b]!, oppBoards[b]!) * weight * relevance;
  }

  const myMeta = threatBits(metaMine, metaOpp | metaDraw);
  const oppMeta = threatBits(metaOpp, metaMine | metaDraw);

  score += twosOf(myMeta) * 105 + onesOf(myMeta) * 20 + forksOf(myMeta) * 165;
  score -= twosOf(oppMeta) * 125 + onesOf(oppMeta) * 24 + forksOf(oppMeta) * 190;

  if (state.active === 9) {
    // Free choice of board is a real tempo edge.
    score += state.side === forSide ? 28 : -28;
  } else {
    const active = state.active;
    const free =
      (myBoards[active]! | oppBoards[active]!) ^ FULL_MASK;
    const mobility = POPCOUNT[free]!;
    const moverIsMe = state.side === forSide;
    const moverBits = moverIsMe ? myBoards[active]! : oppBoards[active]!;
    const waiterBits = moverIsMe ? oppBoards[active]! : myBoards[active]!;

    const moverThreats = threatBits(moverBits, waiterBits);
    const waiterThreats = threatBits(waiterBits, moverBits);

    // Side to move gains from options and from owning threats where it must play.
    let local =
      mobility * 0.9 +
      twosOf(moverThreats) * 9 +
      onesOf(moverThreats) * 2.2 -
      twosOf(waiterThreats) * 7.5;
    // Being forced into a board the waiting side dominates is bad.
    local -= forksOf(waiterThreats) * 12;
    score += moverIsMe ? local : -local;
  }

  if (metaMine & (1 << 4)) score += 16;
  else if (metaOpp & (1 << 4)) score -= 16;

  return Math.round(score);
}

function localBoardScore(myBits: number, oppBits: number): number {
  const mine = threatBits(myBits, oppBits);
  const theirs = threatBits(oppBits, myBits);

  let score =
    twosOf(mine) * 15 +
    onesOf(mine) * 3.4 +
    forksOf(mine) * 32 -
    twosOf(theirs) * 16.5 -
    onesOf(theirs) * 3.6 -
    forksOf(theirs) * 34;

  if (myBits & 0x10) score += 2.6;
  else if (oppBits & 0x10) score -= 2.6;

  const corners = 0b101000101;
  score += POPCOUNT[myBits & corners]! * 0.75;
  score -= POPCOUNT[oppBits & corners]! * 0.75;
  return score;
}

/**
 * How attractive the board we are about to send the opponent into is, from
 * the opponent's point of view. Higher means worse for us.
 */
function sendDanger(
  state: SearchState,
  target: number,
  oppSide: 0 | 1,
  mySide: 0 | 1,
  deadForOpp: number,
): number {
  const oppBits = state.bits[oppSide][target]!;
  const myBits = state.bits[mySide][target]!;
  const free = (oppBits | myBits) ^ FULL_MASK;
  if (free === 0) return 0;

  const oppThreats = threatBits(oppBits, myBits);
  const oppTwos = twosOf(oppThreats);
  let danger = oppTwos * 16 + forksOf(oppThreats) * 26 + onesOf(oppThreats) * 2;

  // Winning that board immediately is far worse when it advances a meta line.
  if (oppTwos > 0) {
    danger += liveLinesThrough(target, deadForOpp) * 9;
  }
  // A board we already dominate is a safe place to send them.
  danger -= twosOf(threatBits(myBits, oppBits)) * 7;
  return danger;
}

/**
 * Shared move classification for ordering, LMR and forcing search.
 * Writes into `out` so the search can classify without allocating.
 */
export function classifyInto(
  state: SearchState,
  move: Move,
  out: MoveFeatures,
): MoveFeatures {
  const side = state.side;
  const oppSide = (1 - side) as 0 | 1;
  const board = move.board;
  const myBits = state.bits[side][board]!;
  const oppBits = state.bits[oppSide][board]!;
  const cellBit = 1 << move.cell;

  const afterMine = myBits | cellBit;
  const localWin = IS_WIN[afterMine] === 1;
  const metaMine = state.metaBits[side]!;
  const metaOpp = state.metaBits[oppSide]!;
  const metaDraw = state.metaBits[2]!;

  const metaAfter = metaMine | (1 << board);
  const metaWin = localWin && IS_WIN[metaAfter] === 1;

  let metaThreat = false;
  if (localWin && !metaWin) {
    const t = threatBits(metaAfter, metaOpp | metaDraw);
    metaThreat = twosOf(t) > 0 || forksOf(t) > 0;
  }

  const afterTheirs = oppBits | cellBit;
  const localBlock = IS_WIN[afterTheirs] === 1;
  const metaBlock = localBlock && IS_WIN[metaOpp | (1 << board)] === 1;

  const freeSend = state.winners[move.cell] !== 0;
  const forcing = metaWin || metaBlock || localWin || localBlock || metaThreat;
  const quiet = !forcing && !freeSend;

  let orderBonus =
    CELL_WEIGHTS[move.cell]! * 4 + POSITION_WEIGHTS[board]! * 3;
  if (metaWin) orderBonus += 50_000;
  else if (metaBlock) orderBonus += 40_000;
  else if (localWin) orderBonus += 900;
  else if (localBlock) orderBonus += 700;
  if (metaThreat) orderBonus += 140;

  if (freeSend) {
    // Handing over a free choice of board is usually a concession.
    orderBonus -= 55;
  } else {
    const deadForOpp = BLOCKED_LINES[metaMine | metaDraw]!;
    orderBonus -= sendDanger(state, move.cell, oppSide, side, deadForOpp) * 0.9;
  }

  out.localWin = localWin;
  out.localBlock = localBlock;
  out.metaWin = metaWin;
  out.metaBlock = metaBlock;
  out.metaThreat = metaThreat;
  out.freeSend = freeSend;
  out.forcing = forcing;
  out.quiet = quiet;
  out.orderBonus = Math.round(orderBonus);
  out.flags =
    (localWin ? F_LOCAL_WIN : 0) |
    (localBlock ? F_LOCAL_BLOCK : 0) |
    (metaWin ? F_META_WIN : 0) |
    (metaBlock ? F_META_BLOCK : 0) |
    (metaThreat ? F_META_THREAT : 0) |
    (freeSend ? F_FREE_SEND : 0) |
    (forcing ? F_FORCING : 0) |
    (quiet ? F_QUIET : 0);
  return out;
}

/** Allocating wrapper for callers outside the search hot path. */
export function classifyMove(state: SearchState, move: Move): MoveFeatures {
  return classifyInto(state, move, emptyFeatures());
}

/** Packed feature flags only; no allocation. */
export function classifyFlags(state: SearchState, move: Move): number {
  return classifyInto(state, move, scratchFeatures).flags;
}

/** Cheap ordering score; avoids building the full feature object. */
export function orderScore(state: SearchState, move: Move): number {
  return classifyInto(state, move, scratchFeatures).orderBonus;
}

export function isTacticalMove(state: SearchState, move: Move): boolean {
  return (classifyFlags(state, move) & F_FORCING) !== 0;
}

/**
 * Moves worth searching past the horizon: meta-decisive moves plus local
 * wins and blocks, which drive nearly every tactical sequence in UTTT.
 */
export function isForcingHorizonMove(state: SearchState, move: Move): boolean {
  const flags = classifyFlags(state, move);
  return (
    (flags &
      (F_META_WIN | F_META_BLOCK | F_META_THREAT | F_LOCAL_WIN | F_LOCAL_BLOCK)) !==
    0
  );
}

export { MATE, POSITION_WEIGHTS };
