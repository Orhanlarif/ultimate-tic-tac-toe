import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMove,
  applyMoves,
  createGame,
  getLegalMoves,
  type GameState,
  type Move,
} from "@uttt/game-engine";
import { summarizePairs, type EloReport, type PairScore } from "./arenaStats.js";
import { chooseMove, createRng, getProfile, type Difficulty } from "./index.js";

export interface ArenaPosition {
  id: string;
  tag: "early" | "mid" | "late" | "endgame";
  moves: Move[];
}

export interface ArenaMatchConfig {
  candidate: Difficulty;
  baseline: Difficulty;
  /**
   * Scales each side's profile node/depth budgets.
   * 1 = full profile caps (slow); 0.15–0.4 is CI-friendly while preserving order.
   */
  budgetScale: number;
  /** Soft wall-clock safety cap per move. */
  timeMs: number;
  seed: number;
}

export interface ArenaResult {
  positions: number;
  games: number;
  report: EloReport;
  illegal: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load checked-in corpus when present; otherwise build deterministically. */
export function loadArenaPositions(): ArenaPosition[] {
  try {
    const path = join(__dirname, "fixtures", "arena-50.json");
    const raw = JSON.parse(readFileSync(path, "utf8")) as ArenaPosition[];
    if (Array.isArray(raw) && raw.length >= 50) return raw.slice(0, 50);
  } catch {
    // Fall through to generated corpus.
  }
  return buildArena50();
}

/** Build the fixed 50-position corpus deterministically. */
export function buildArena50(): ArenaPosition[] {
  const out: ArenaPosition[] = [];
  const specs: Array<{ tag: ArenaPosition["tag"]; ply: number; count: number; seed: number }> = [
    { tag: "early", ply: 12, count: 10, seed: 1000 },
    { tag: "mid", ply: 24, count: 15, seed: 2000 },
    { tag: "late", ply: 36, count: 15, seed: 3000 },
    { tag: "endgame", ply: 48, count: 10, seed: 4000 },
  ];

  for (const spec of specs) {
    let made = 0;
    let attempt = 0;
    while (made < spec.count && attempt < spec.count * 40) {
      const moves = playRandomPlies(spec.ply, spec.seed + attempt * 17);
      attempt += 1;
      if (!moves) continue;
      const built = applyMoves(moves);
      if (!built.ok || built.state.status !== "in_progress") continue;
      if (spec.tag === "endgame") {
        const empties = countPlayable(built.state);
        if (empties > 14 || empties < 4) continue;
      }
      out.push({
        id: `${spec.tag}-${made}`,
        tag: spec.tag,
        moves,
      });
      made += 1;
    }
    while (made < spec.count) {
      const moves = playRandomPlies(Math.max(4, spec.ply - 10), spec.seed + 9000 + made);
      if (!moves) break;
      out.push({ id: `${spec.tag}-fb-${made}`, tag: spec.tag, moves });
      made += 1;
    }
  }
  return out.slice(0, 50);
}

function playRandomPlies(ply: number, seed: number): Move[] | null {
  const rng = createRng(seed);
  let state = createGame();
  const moves: Move[] = [];
  for (let i = 0; i < ply; i++) {
    if (state.status !== "in_progress") return null;
    const legal = getLegalMoves(state);
    if (legal.length === 0) return null;
    const move = legal[Math.floor(rng() * legal.length)]!;
    const next = applyMove(state, move);
    if (!next.ok) return null;
    moves.push(move);
    state = next.state;
  }
  return state.status === "in_progress" ? moves : null;
}

function countPlayable(state: GameState): number {
  let n = 0;
  for (let b = 0; b < 9; b++) {
    if (state.boardWinners[b]) continue;
    for (let c = 0; c < 9; c++) if (state.boards[b]![c] === null) n += 1;
  }
  return n;
}

export function runArena(
  positions: ArenaPosition[],
  config: ArenaMatchConfig,
): ArenaResult {
  const pairs: PairScore[] = [];
  let illegal = 0;
  let games = 0;

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const start = replay(pos.moves);
    let points = 0;
    for (const [candIsX] of [
      [true],
      [false],
    ] as const) {
      const result = playFrom(
        start,
        candIsX ? config.candidate : config.baseline,
        candIsX ? config.baseline : config.candidate,
        config,
        config.seed + i * 1009 + (candIsX ? 0 : 1),
      );
      games += 1;
      illegal += result.illegal;
      if (result.winner === "X") points += candIsX ? 1 : 0;
      else if (result.winner === "O") points += candIsX ? 0 : 1;
      else points += 0.5;
    }
    pairs.push({ q: points });
  }

  return {
    positions: positions.length,
    games,
    report: summarizePairs(pairs, { seed: config.seed }),
    illegal,
  };
}

function replay(moves: Move[]): GameState {
  const built = applyMoves(moves);
  if (!built.ok) throw new Error(built.error);
  return built.state;
}

/** Keep Easy < Medium < Hard depth floors so scaling never collapses everyone to 1. */
function minDepthFor(difficulty: Difficulty): number {
  if (difficulty === "hard") return 3;
  if (difficulty === "medium") return 2;
  return 1;
}

function sideBudgets(difficulty: Difficulty, scale: number, timeMs: number) {
  const profile = getProfile(difficulty);
  const s = Math.min(1, Math.max(0.05, scale));
  const scaledDepth = Math.round(profile.maxDepth * Math.min(1, s * 2));
  return {
    timeMs: Math.min(profile.timeMs, timeMs),
    maxDepth: Math.max(minDepthFor(difficulty), scaledDepth),
    nodeBudget: Math.max(
      difficulty === "hard" ? 2_000 : difficulty === "medium" ? 800 : 200,
      Math.round(profile.nodeBudget * s),
    ),
  };
}

function playFrom(
  start: GameState,
  x: Difficulty,
  o: Difficulty,
  config: ArenaMatchConfig,
  seed: number,
): { winner: "X" | "O" | null; illegal: number } {
  let state = start;
  let guard = 0;
  let illegal = 0;
  while (state.status === "in_progress" && guard < 90) {
    const difficulty = state.currentPlayer === "X" ? x : o;
    const budgets = sideBudgets(difficulty, config.budgetScale, config.timeMs);
    const move = chooseMove(state, {
      difficulty,
      seed: seed + guard * 9973,
      timeMs: budgets.timeMs,
      maxDepth: budgets.maxDepth,
      nodeBudget: budgets.nodeBudget,
      useOpenings: false,
      gameId: `arena-${seed}`,
    });
    const next = applyMove(state, move);
    if (!next.ok) {
      illegal += 1;
      break;
    }
    state = next.state;
    guard += 1;
  }
  return { winner: state.winner, illegal };
}
