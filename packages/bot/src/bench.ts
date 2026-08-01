/**
 * Search throughput / depth benchmark.
 *
 * Usage: npm run bench -w @uttt/bot
 *
 * The `nps` run pins every position to the same node budget with the depth cap
 * lifted, so total work is near-constant and wall time is directly comparable
 * between engine revisions. The `profile` run reports what the shipped Hard
 * profile actually reaches.
 */
import { applyMove, createGame, getLegalMoves, type GameState } from "@uttt/game-engine";
import { loadArenaPositions } from "./arena.js";
import { getProfile } from "./difficulty.js";
import { createRng } from "./index.js";
import { searchBestMove } from "./search.js";

function replay(moves: { board: number; cell: number }[]): GameState {
  let state = createGame();
  for (const m of moves) {
    const next = applyMove(state, m as never);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  return state;
}

interface Row {
  nodes: number;
  ms: number;
  depth: number;
  count: number;
  aborted: number;
}

function run(
  states: GameState[],
  budgets: { timeMs: number; maxDepth: number; nodeBudget: number },
): Row {
  const row: Row = { nodes: 0, ms: 0, depth: 0, count: 0, aborted: 0 };
  const profile = getProfile("hard");
  for (const state of states) {
    const result = searchBestMove(state, profile, createRng(7), budgets);
    row.nodes += result.info.nodes;
    row.ms += result.info.timeMs;
    row.depth += result.info.depth;
    if (result.info.aborted) row.aborted += 1;
    row.count += 1;
  }
  return row;
}

function report(label: string, row: Row): void {
  const nps = row.nodes / (row.ms / 1000);
  console.log(
    `${label.padEnd(9)} positions=${row.count} nodes=${row.nodes.toLocaleString("en-US")} ` +
      `time=${row.ms.toFixed(0)}ms nps=${Math.round(nps).toLocaleString("en-US")} ` +
      `avgDepth=${(row.depth / row.count).toFixed(2)} aborted=${row.aborted}`,
  );
}

function main(): void {
  const positions = loadArenaPositions();
  const profile = getProfile("hard");
  const states = positions
    .filter((p) => p.tag !== "endgame")
    .slice(0, 24)
    .map((p) => replay(p.moves))
    .filter((s) => getLegalMoves(s).length > 0);

  // Warm up JIT so the first measured position is not paying for tier-up.
  run(states.slice(0, 4), { timeMs: 200, maxDepth: 6, nodeBudget: 50_000 });

  report(
    "nps",
    run(states, { timeMs: 600_000, maxDepth: 64, nodeBudget: 400_000 }),
  );
  report(
    "profile",
    run(states, {
      timeMs: profile.timeMs,
      maxDepth: profile.maxDepth,
      nodeBudget: profile.nodeBudget,
    }),
  );
}

main();
