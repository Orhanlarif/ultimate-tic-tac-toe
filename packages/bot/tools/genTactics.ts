/**
 * Generates the tactical regression corpus in `src/fixtures/tactics.json`.
 *
 * A position qualifies when a deep search proves a forced meta win but a much
 * shallower search misses it, which is exactly the band where search
 * regressions show up first. Ground truth is every root move that still mates.
 *
 * Usage: npx tsx tools/genTactics.ts [target] [seed]
 */
import { writeFileSync } from "node:fs";
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
import { chooseMoveDetailed, createRng, MATE } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEEP = { nodeBudget: 4_000_000, maxDepth: 60, timeMs: 600_000 };
const SHALLOW = { nodeBudget: 6_000, maxDepth: 60, timeMs: 600_000 };
/** Budget the regression test itself will use; must be enough to solve each case. */
const TEST = { nodeBudget: 250_000, maxDepth: 60, timeMs: 600_000 };

interface TacticCase {
  id: string;
  moves: Move[];
  /** Side to move, for readability in failure output. */
  sideToMove: "X" | "O";
  /** Every root move that keeps the forced win. */
  winningMoves: Move[];
  /** Plies to mate reported by the deep search. */
  mateIn: number;
}

function search(state: GameState, budgets: typeof DEEP, seed: number) {
  return chooseMoveDetailed(state, {
    difficulty: "hard",
    seed,
    useOpenings: false,
    ...budgets,
  });
}

function isMate(score: number): boolean {
  return score >= MATE - 200;
}

/** All root moves that still force a win, verified one by one. */
function collectWinningMoves(state: GameState): Move[] {
  const out: Move[] = [];
  for (const move of getLegalMoves(state)) {
    const next = applyMove(state, move);
    if (!next.ok) continue;
    if (next.state.status === "won") {
      out.push(move);
      continue;
    }
    if (next.state.status === "draw") continue;
    // After our move it is the opponent's turn, so a forced win for us shows up
    // as a forced loss from their point of view.
    const reply = search(next.state, DEEP, 5);
    if (reply.info.score <= -(MATE - 200)) out.push(move);
  }
  return out;
}

function randomPlies(ply: number, seed: number): Move[] | null {
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

function main(): void {
  const target = Number(process.argv[2] ?? 24);
  const baseSeed = Number(process.argv[3] ?? 77);
  const cases: TacticCase[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  const t0 = Date.now();

  while (cases.length < target && attempts < target * 60) {
    attempts += 1;
    const ply = 26 + (attempts % 22);
    const moves = randomPlies(ply, baseSeed + attempts * 131);
    if (!moves) continue;
    const key = moves.map((m) => `${m.board}${m.cell}`).join("");
    if (seen.has(key)) continue;
    seen.add(key);

    const built = applyMoves(moves);
    if (!built.ok || built.state.status !== "in_progress") continue;
    const state = built.state;

    const deep = search(state, DEEP, 3);
    if (!isMate(deep.info.score) || deep.info.aborted) continue;

    // Keep only the cases a shallow search fails to find; the rest prove nothing.
    const shallow = search(state, SHALLOW, 3);
    if (isMate(shallow.info.score)) continue;

    const legalCount = getLegalMoves(state).length;
    const winningMoves = collectWinningMoves(state);
    // A case only discriminates when winning is a narrow choice; positions where
    // almost anything wins would pass even with a broken search.
    if (winningMoves.length === 0) continue;
    if (legalCount < 4 || winningMoves.length > legalCount / 2) continue;

    // The case is only usable if the shipped test budget actually solves it.
    const verify = search(state, TEST, 3);
    const solved = winningMoves.some(
      (m) => m.board === verify.move.board && m.cell === verify.move.cell,
    );
    if (!solved) continue;

    cases.push({
      id: `mate-${String(cases.length).padStart(2, "0")}`,
      moves,
      sideToMove: state.currentPlayer,
      winningMoves,
      mateIn: MATE - Math.abs(deep.info.score),
    });
    process.stdout.write(
      `${cases.length}/${target} ply=${ply} mateIn=${MATE - Math.abs(deep.info.score)} ` +
        `winners=${winningMoves.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
    );
  }

  const path = join(__dirname, "..", "src", "fixtures", "tactics.json");
  writeFileSync(path, `${JSON.stringify(cases, null, 2)}\n`);
  console.log(`\nWrote ${cases.length} cases to ${path} (attempts=${attempts})`);
}

main();
