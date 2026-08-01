import type { Move, Player } from "@uttt/game-engine";
import type { BotSearchSession } from "./session.js";

export type Difficulty = "easy" | "medium" | "hard";

export interface ChooseMoveOptions {
  difficulty: Difficulty;
  seed: number;
  /** Wall-clock thinking budget in milliseconds. */
  timeMs?: number;
  /** Soft node budget; used as a secondary stop condition. */
  nodeBudget?: number;
  /** Hard depth cap for iterative deepening. */
  maxDepth?: number;
  /** Optional abort signal for worker cancellation. */
  shouldAbort?: () => boolean;
  /** Override opening-book usage from the difficulty profile. */
  useOpenings?: boolean;
  /** Persistent TT session (Worker). Fresh ephemeral session if omitted. */
  session?: BotSearchSession;
  /** Stable id for the current game; used to retain/clear the session TT. */
  gameId?: string;
  /** Seat the bot is playing; used with gameId for session TT lifetime. */
  botPlayer?: Player;
  /** Test/override hook for principal variation search. */
  usePvs?: boolean;
}

export interface SolverInfo {
  attempted: boolean;
  solved: boolean;
  outcome?: -1 | 0 | 1;
  distance?: number;
  nodes: number;
  reason?: "time" | "nodes" | "ineligible" | "solved";
}

export interface SearchInfo {
  depth: number;
  nodes: number;
  timeMs: number;
  ttHits: number;
  aborted: boolean;
  score: number;
  reSearches?: number;
  lmrReductions?: number;
  qNodes?: number;
  solver?: SolverInfo;
}

export interface ChooseMoveResult {
  move: Move;
  info: SearchInfo;
}

export interface DifficultyProfile {
  id: Difficulty;
  /** Wall-clock cap. Binding for Hard, slack for the lower levels. */
  timeMs: number;
  /** Iterative-deepening cap. The strength dial for Easy and Medium. */
  maxDepth: number;
  /** Node cap. The strength dial for Hard, a runaway guard for the rest. */
  nodeBudget: number;
  /**
   * Root-score window for near-equal candidates.
   * 0 means always play the principal variation move.
   */
  candidateWindow: number;
  /**
   * Softmax temperature over candidate scores.
   * 0 means pick the best candidate deterministically (still seed-stable).
   */
  candidateTemperature: number;
  /**
   * Probability of picking a meta-safe near-miss instead of the top move.
   * Used to give Easy a more human-like error rate.
   */
  softBlunderRate: number;
  /**
   * Play the meta-block / only-safe-move heuristic without searching it.
   * Shallow profiles need it for correctness; deep ones can verify it instead,
   * and occasionally find something better.
   */
  trustTacticalShortcuts: boolean;
  useTt: boolean;
  useOpenings: boolean;
  /** When true, opening book returns the principal line only (no variety). */
  openingPrincipal: boolean;
  usePvs: boolean;
  useLmr: boolean;
  /** Max forcing-search plies at the horizon. */
  qDepth: number;
  /** Selective-extension budget per search path (0 disables extensions). */
  maxExtensions: number;
  /** Transposition table size as power of two. */
  ttSizePower: number;
  /** Exact endgame solver: auto when emptyCount <= this. */
  endgameEmptyAuto: number;
  /** Exact endgame solver: try when emptyCount <= this and branching is low. */
  endgameEmptyTry: number;
  /** Fraction of remaining nodes reserved for the exact solver attempt. */
  endgameNodeShare: number;
}

export type Side = 0 | 1; // 0 = X, 1 = O

export function playerToSide(player: Player): Side {
  return player === "X" ? 0 : 1;
}

export function sideToPlayer(side: Side): Player {
  return side === 0 ? "X" : "O";
}
