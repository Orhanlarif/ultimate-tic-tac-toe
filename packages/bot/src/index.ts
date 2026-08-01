import type { GameState, Move } from "@uttt/game-engine";
import { applyMove, createGame, getLegalMoves } from "@uttt/game-engine";
import { getProfile } from "./difficulty.js";
import { openingMove } from "./opening.js";
import { pickEmergencyMove, searchBestMove } from "./search.js";
import type {
  ChooseMoveOptions,
  ChooseMoveResult,
  Difficulty,
  SearchInfo,
} from "./types.js";

export type { Difficulty, ChooseMoveOptions, ChooseMoveResult, SearchInfo, SolverInfo } from "./types.js";
export {
  DIFFICULTY_PROFILES,
  DIFFICULTY_TIMEOUT_MARGIN_MS,
  getHostTimeoutMs,
  getProfile,
} from "./difficulty.js";
export { mctsBestMove } from "./mcts.js";
export type { MctsOptions } from "./mcts.js";
export { pickEmergencyMove } from "./search.js";
export { SearchState, computeHash, hashesMatch } from "./searchState.js";
export { evaluate, classifyMove } from "./evaluation.js";
export { BotSearchSession } from "./session.js";
export { TranspositionTable, TT_EXACT, TT_LOWER, TT_UPPER } from "./tt.js";
export { solveExact, endgameEligible } from "./endgame.js";
export { EndgameTable } from "./endgameTable.js";
export { MATE } from "./constants.js";

/** Mulberry32 seeded PRNG — deterministic across runs. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function chooseMove(state: GameState, opts: ChooseMoveOptions): Move {
  return chooseMoveDetailed(state, opts).move;
}

export function chooseMoveDetailed(
  state: GameState,
  opts: ChooseMoveOptions,
): ChooseMoveResult {
  if (state.status !== "in_progress") {
    throw new Error("Game is over");
  }
  const legal = getLegalMoves(state);
  if (legal.length === 0) throw new Error("No legal moves");

  const profile = getProfile(opts.difficulty);
  const rng = createRng(opts.seed);

  const useOpenings = opts.useOpenings ?? profile.useOpenings;
  if (useOpenings) {
    const book = openingMove(state, rng, {
      principal: profile.openingPrincipal,
    });
    if (book && legal.some((m: Move) => m.board === book.board && m.cell === book.cell)) {
      return {
        move: book,
        info: {
          depth: 0,
          nodes: 0,
          timeMs: 0,
          ttHits: 0,
          aborted: false,
          score: 0,
        },
      };
    }
  }

  return searchBestMove(state, profile, rng, {
    timeMs: opts.timeMs,
    maxDepth: opts.maxDepth,
    nodeBudget: opts.nodeBudget,
    shouldAbort: opts.shouldAbort,
    session: opts.session,
    gameId: opts.gameId ?? String(opts.seed),
    botPlayer: opts.botPlayer,
    usePvs: opts.usePvs,
  });
}

export interface PlayBotGameOptions {
  /**
   * Use smaller per-side caps derived from each difficulty profile.
   * Keeps Hard > Medium > Easy separation while staying CI-friendly.
   */
  fast?: boolean;
  /** Optional starting position instead of a fresh game. */
  startState?: GameState;
}

function budgetsFor(difficulty: Difficulty, fast: boolean) {
  const profile = getProfile(difficulty);
  if (!fast) {
    return {
      timeMs: profile.timeMs,
      maxDepth: profile.maxDepth,
      nodeBudget: profile.nodeBudget,
    };
  }
  if (difficulty === "hard") {
    return {
      timeMs: Math.min(profile.timeMs, 55),
      maxDepth: Math.min(profile.maxDepth, 4),
      nodeBudget: Math.min(profile.nodeBudget, 5_000),
    };
  }
  if (difficulty === "medium") {
    return {
      timeMs: Math.min(profile.timeMs, 35),
      maxDepth: Math.min(profile.maxDepth, 3),
      nodeBudget: Math.min(profile.nodeBudget, 2_200),
    };
  }
  return {
    timeMs: Math.min(profile.timeMs, 20),
    maxDepth: Math.min(profile.maxDepth, 1),
    nodeBudget: Math.min(profile.nodeBudget, 500),
  };
}

/** Play a complete bot-vs-bot game; returns winner or null for draw. */
export function playBotGame(
  x: Difficulty,
  o: Difficulty,
  seed: number,
  opts: PlayBotGameOptions = { fast: true },
): { winner: "X" | "O" | null; moves: number } {
  let state = opts.startState ? opts.startState : createGame();
  let guard = 0;
  const fast = opts.fast ?? true;
  while (state.status === "in_progress" && guard < 90) {
    const difficulty = state.currentPlayer === "X" ? x : o;
    const budgets = budgetsFor(difficulty, fast);
    const move = chooseMove(state, {
      difficulty,
      seed: seed + guard * 9973,
      timeMs: budgets.timeMs,
      maxDepth: budgets.maxDepth,
      nodeBudget: budgets.nodeBudget,
      useOpenings: false,
      gameId: `play-${seed}`,
    });
    const next = applyMove(state, move);
    if (!next.ok) {
      const emergency = pickEmergencyMove(state, seed + guard);
      const retry = applyMove(state, emergency);
      if (!retry.ok) break;
      state = retry.state;
    } else {
      state = next.state;
    }
    guard += 1;
  }
  return { winner: state.winner, moves: state.moveCount };
}
