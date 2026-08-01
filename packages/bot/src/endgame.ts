import type { Move } from "@uttt/game-engine";
import type { SearchBudget } from "./budget.js";
import { budgetExhausted } from "./budget.js";
import {
  ENDGAME_EMPTY,
  stmDistance,
  stmOutcome,
  type EndgameTable,
} from "./endgameTable.js";
import { classifyMove, F_META_BLOCK, F_META_WIN, orderScore } from "./evaluation.js";
import type { SearchState } from "./searchState.js";
import type { SolverInfo } from "./types.js";

export type SolveResult =
  | {
      status: "solved";
      outcome: -1 | 0 | 1;
      move: Move;
      distance: number;
      nodes: number;
    }
  | {
      status: "unknown";
      nodes: number;
      reason: "time" | "nodes" | "ineligible";
    };

/**
 * Exact terminal-only alpha-beta. Never returns solved unless the full
 * required subtree is proven within the shared budget.
 */
export function solveExact(
  state: SearchState,
  rootSide: 0 | 1,
  budget: SearchBudget,
  opts?: { maxEmpty?: number; maxBranching?: number; table?: EndgameTable | null },
): SolveResult {
  const startNodes = budget.nodes;
  const maxEmpty = opts?.maxEmpty ?? 12;
  const maxBranching = opts?.maxBranching ?? 8;
  const table = opts?.table ?? null;

  if (state.status !== 0 || state.emptyCount > maxEmpty) {
    return {
      status: "unknown",
      nodes: 0,
      reason: "ineligible",
    };
  }

  const rootMoves: Move[] = [];
  state.collectMoves(rootMoves);
  if (rootMoves.length === 0 || rootMoves.length > maxBranching) {
    return {
      status: "unknown",
      nodes: budget.nodes - startNodes,
      reason: "ineligible",
    };
  }

  rootMoves.sort((a, b) => orderScore(state, b) - orderScore(state, a));

  let bestMove = rootMoves[0]!;
  let bestOutcome: -1 | 0 | 1 = -1;
  let bestDistance = 99;
  let provedAll = true;

  for (const move of rootMoves) {
    if (budgetExhausted(budget)) {
      return {
        status: "unknown",
        nodes: budget.nodes - startNodes,
        reason: budget.nodes >= budget.nodeBudget ? "nodes" : "time",
      };
    }
    state.make(move);
    const child = negamaxExact(state, rootSide, budget, 1, table);
    state.unmake();
    if (child === UNKNOWN) {
      provedAll = false;
      break;
    }
    const outcome = decodeOutcome(child);
    const distance = decodeDistance(child);
    if (betterExact(outcome, distance, bestOutcome, bestDistance, true)) {
      bestOutcome = outcome;
      bestDistance = distance;
      bestMove = move;
    }
    // Proven win: remaining moves cannot improve past a win.
    if (bestOutcome === 1) break;
  }

  if (!provedAll || budget.aborted) {
    return {
      status: "unknown",
      nodes: budget.nodes - startNodes,
      reason: budget.nodes >= budget.nodeBudget ? "nodes" : "time",
    };
  }

  return {
    status: "solved",
    outcome: bestOutcome,
    move: bestMove,
    distance: bestDistance,
    nodes: budget.nodes - startNodes,
  };
}

/** Sentinel for "budget exhausted, no proven value". */
const UNKNOWN = -1;

/** Encodes (outcome from root's view, absolute distance) into one integer. */
function encode(outcome: -1 | 0 | 1, distance: number): number {
  return (outcome + 1) * 128 + distance;
}

function decodeOutcome(value: number): -1 | 0 | 1 {
  return ((value >> 7) - 1) as -1 | 0 | 1;
}

function decodeDistance(value: number): number {
  return value & 127;
}

const exactPool: Move[][] = Array.from({ length: 128 }, () => []);
const exactScratch = new Int32Array(81);

/**
 * Returns an encoded (outcome, absolute distance) pair, or UNKNOWN when the
 * budget ran out before the subtree could be proven.
 */
function negamaxExact(
  state: SearchState,
  rootSide: 0 | 1,
  budget: SearchBudget,
  ply: number,
  table: EndgameTable | null,
): number {
  budget.nodes += 1;
  if (budgetExhausted(budget)) return UNKNOWN;

  if (state.status === 1) {
    const win = state.winner === rootSide + 1 ? 1 : -1;
    return encode(win as -1 | 1, ply);
  }
  if (state.status === 2) return encode(0, ply);

  const maximizing = state.side === rootSide;

  if (table) {
    const hit = table.probeAt(state.hashLo, state.hashHi);
    if (hit !== ENDGAME_EMPTY) {
      // Stored relative to side to move and to this node.
      const stm = stmOutcome(hit);
      const outcome = (maximizing ? stm : -stm) as -1 | 0 | 1;
      return encode(outcome, ply + stmDistance(hit));
    }
  }

  const moves = exactPool[Math.min(ply, exactPool.length - 1)]!;
  state.collectMoves(moves);
  if (moves.length === 0) return encode(0, ply);

  const n = moves.length;
  for (let i = 0; i < n; i++) exactScratch[i] = orderScore(state, moves[i]!);
  for (let i = 1; i < n; i++) {
    const move = moves[i]!;
    const score = exactScratch[i]!;
    let j = i - 1;
    while (j >= 0 && exactScratch[j]! < score) {
      moves[j + 1] = moves[j]!;
      exactScratch[j + 1] = exactScratch[j]!;
      j -= 1;
    }
    moves[j + 1] = move;
    exactScratch[j + 1] = score;
  }

  let bestOutcome: -1 | 0 | 1 = maximizing ? -1 : 1;
  let bestDistance = maximizing ? 99 : 0;

  for (let i = 0; i < n; i++) {
    state.make(moves[i]!);
    const child = negamaxExact(state, rootSide, budget, ply + 1, table);
    state.unmake();
    if (child === UNKNOWN) return UNKNOWN;

    const childOutcome = decodeOutcome(child);
    const childDistance = decodeDistance(child);
    if (
      betterExact(
        childOutcome,
        childDistance,
        bestOutcome,
        bestDistance,
        maximizing,
      )
    ) {
      bestOutcome = childOutcome;
      bestDistance = childDistance;
    }
    if (maximizing ? bestOutcome === 1 : bestOutcome === -1) break;
  }

  if (table) {
    const stm = (maximizing ? bestOutcome : -bestOutcome) as -1 | 0 | 1;
    table.storeAt(state.hashLo, state.hashHi, stm, bestDistance - ply);
  }

  return encode(bestOutcome, bestDistance);
}

/**
 * Prefer better outcome; on ties speed up wins / draws and delay losses
 * from the maximizing (root) perspective. Minimizing inverts that.
 */
export function betterExact(
  outcome: -1 | 0 | 1,
  distance: number,
  bestOutcome: -1 | 0 | 1,
  bestDistance: number,
  maximizing: boolean,
): boolean {
  if (maximizing) {
    if (outcome > bestOutcome) return true;
    if (outcome < bestOutcome) return false;
    if (outcome > 0) return distance < bestDistance;
    if (outcome < 0) return distance > bestDistance;
    return distance < bestDistance;
  }
  if (outcome < bestOutcome) return true;
  if (outcome > bestOutcome) return false;
  // Opponent: force root losses faster, delay root wins, delay draws.
  if (outcome < 0) return distance < bestDistance;
  if (outcome > 0) return distance > bestDistance;
  return distance > bestDistance;
}

export function endgameEligible(
  state: SearchState,
  autoEmpty: number,
  tryEmpty: number,
): { eligible: boolean; maxEmpty: number; maxBranching: number } {
  if (autoEmpty <= 0 && tryEmpty <= 0) {
    return { eligible: false, maxEmpty: 0, maxBranching: 0 };
  }
  if (state.emptyCount <= autoEmpty) {
    return { eligible: true, maxEmpty: autoEmpty, maxBranching: 81 };
  }
  if (state.emptyCount <= tryEmpty) {
    const moves: Move[] = [];
    state.collectMoves(moves);
    if (moves.length <= 9 && state.active !== 9) {
      return { eligible: true, maxEmpty: tryEmpty, maxBranching: 9 };
    }
  }
  return { eligible: false, maxEmpty: 0, maxBranching: 0 };
}

export function solverInfoFrom(result: SolveResult): SolverInfo {
  if (result.status === "solved") {
    return {
      attempted: true,
      solved: true,
      outcome: result.outcome,
      distance: result.distance,
      nodes: result.nodes,
      reason: "solved",
    };
  }
  return {
    attempted: result.reason !== "ineligible",
    solved: false,
    nodes: result.nodes,
    reason: result.reason,
  };
}

/** Prefer forcing meta moves when scanning exact children. */
export function exactMovePriority(state: SearchState, move: Move): number {
  const f = classifyMove(state, move);
  if (f.flags & F_META_WIN) return 1_000_000;
  if (f.flags & F_META_BLOCK) return 900_000;
  return f.orderBonus;
}
