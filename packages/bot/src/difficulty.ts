import type { Difficulty, DifficultyProfile } from "./types.js";

/**
 * Single source of truth for bot strength.
 *
 * Easy and Medium are governed by `maxDepth`; they finish long before their node
 * budget, which is only a runaway guard. Hard is governed by `nodeBudget` and
 * `timeMs` together: the budget is set high enough that a fast device spends the
 * whole latency allowance, and a slow device simply returns its deepest
 * completed iteration instead of stalling.
 */
export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    id: "easy",
    timeMs: 100,
    maxDepth: 2,
    nodeBudget: 2_500,
    candidateWindow: 120,
    candidateTemperature: 0.7,
    softBlunderRate: 0.22,
    trustTacticalShortcuts: true,
    useTt: false,
    useOpenings: false,
    openingPrincipal: false,
    usePvs: false,
    useLmr: false,
    qDepth: 2,
    maxExtensions: 0,
    ttSizePower: 16,
    endgameEmptyAuto: 0,
    endgameEmptyTry: 0,
    endgameNodeShare: 0,
  },
  medium: {
    id: "medium",
    timeMs: 500,
    maxDepth: 6,
    nodeBudget: 60_000,
    candidateWindow: 14,
    candidateTemperature: 0.15,
    softBlunderRate: 0,
    trustTacticalShortcuts: true,
    useTt: true,
    useOpenings: true,
    openingPrincipal: false,
    usePvs: true,
    useLmr: false,
    qDepth: 4,
    maxExtensions: 2,
    ttSizePower: 18,
    endgameEmptyAuto: 0,
    endgameEmptyTry: 0,
    endgameNodeShare: 0,
  },
  hard: {
    id: "hard",
    timeMs: 2_000,
    // Depth is left to the node budget; capping it wasted most of the budget.
    maxDepth: 40,
    nodeBudget: 2_400_000,
    candidateWindow: 0,
    candidateTemperature: 0,
    softBlunderRate: 0,
    trustTacticalShortcuts: false,
    useTt: true,
    useOpenings: true,
    openingPrincipal: true,
    usePvs: true,
    useLmr: true,
    qDepth: 6,
    maxExtensions: 4,
    ttSizePower: 19,
    endgameEmptyAuto: 14,
    endgameEmptyTry: 18,
    endgameNodeShare: 0.75,
  },
};

/**
 * Host-side safety timeout margin above the profile time budget.
 *
 * The worker already stops itself at `timeMs`, so this only has to catch a
 * genuinely stuck worker. It needs enough slack to absorb worker startup, JIT
 * warmup on the first move and a busy main thread — firing it early costs a
 * full-strength move and throws away the persistent transposition table.
 */
export const DIFFICULTY_TIMEOUT_MARGIN_MS = 1_500;

export function getProfile(difficulty: Difficulty): DifficultyProfile {
  return DIFFICULTY_PROFILES[difficulty];
}

export function getHostTimeoutMs(difficulty: Difficulty): number {
  return getProfile(difficulty).timeMs + DIFFICULTY_TIMEOUT_MARGIN_MS;
}
