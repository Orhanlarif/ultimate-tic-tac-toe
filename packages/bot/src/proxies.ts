/**
 * Fixed weak opponents for human-facing difficulty calibration.
 *
 * These are arena baselines, not shipped difficulty profiles. They answer
 * "is Easy actually beginner-friendly?" better than Easy-vs-Medium Elo alone.
 */
import {
  getLegalMoves,
  type GameState,
  type Move,
} from "@uttt/game-engine";
import { orderScore } from "./evaluation.js";
import { searchBestMove } from "./search.js";
import { SearchState } from "./searchState.js";
import type { DifficultyProfile } from "./types.js";

export const PROXY_IDS = ["random", "greedy1", "shallowNoGuard"] as const;
export type ProxyId = (typeof PROXY_IDS)[number];

export function isProxyId(value: string): value is ProxyId {
  return (PROXY_IDS as readonly string[]).includes(value);
}

/** Local Mulberry32 — avoid importing `./index.js` (circular with public exports). */
function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Floor under Easy: depth-1 search, no tactical shortcuts, noisy root. */
const SHALLOW_NO_GUARD: DifficultyProfile = {
  id: "easy",
  timeMs: 80,
  maxDepth: 1,
  nodeBudget: 1_500,
  candidateWindow: 200,
  candidateTemperature: 1.1,
  softBlunderRate: 0.5,
  allowUnsafeBlunders: true,
  trustTacticalShortcuts: false,
  useTt: false,
  useOpenings: false,
  openingPrincipal: false,
  usePvs: false,
  useLmr: false,
  qDepth: 0,
  maxExtensions: 0,
  ttSizePower: 14,
  endgameEmptyAuto: 0,
  endgameEmptyTry: 0,
  endgameNodeShare: 0,
};

function pickInstantMetaWin(state: GameState): Move | null {
  const ss = new SearchState(state);
  const moves: Move[] = [];
  ss.collectMoves(moves);
  const rootSide = ss.side;
  for (const move of moves) {
    ss.make(move);
    const win = ss.status === 1 && ss.winner === rootSide + 1;
    ss.unmake();
    if (win) return move;
  }
  return null;
}

function chooseRandom(state: GameState, seed: number): Move {
  const legal = getLegalMoves(state);
  if (legal.length === 0) throw new Error("No legal moves");
  const rng = createRng(seed);
  return legal[Math.floor(rng() * legal.length)]!;
}

/** Take an instant meta win if any; otherwise max orderScore (no forced block). */
function chooseGreedy1(state: GameState, seed: number): Move {
  const instant = pickInstantMetaWin(state);
  if (instant) return instant;

  const legal = getLegalMoves(state);
  if (legal.length === 0) throw new Error("No legal moves");
  const ss = new SearchState(state);
  let best = legal[0]!;
  let bestScore = -Infinity;
  // Tiny seed jitter breaks exact ties deterministically.
  const rng = createRng(seed);
  for (const move of legal) {
    const score = orderScore(ss, move) + rng() * 1e-6;
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

function chooseShallowNoGuard(state: GameState, seed: number): Move {
  return searchBestMove(state, SHALLOW_NO_GUARD, createRng(seed)).move;
}

export function chooseProxyMove(
  state: GameState,
  proxy: ProxyId,
  seed: number,
): Move {
  switch (proxy) {
    case "random":
      return chooseRandom(state, seed);
    case "greedy1":
      return chooseGreedy1(state, seed);
    case "shallowNoGuard":
      return chooseShallowNoGuard(state, seed);
    default: {
      const _exhaustive: never = proxy;
      throw new Error(`Unknown proxy: ${_exhaustive}`);
    }
  }
}
