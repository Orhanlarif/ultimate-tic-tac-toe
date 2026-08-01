/**
 * Ladder calibration at the profiles players actually get.
 *
 * `calibrate.ts` scales budgets down so it can run quickly, which means it never
 * measures the shipped bot. This script does the opposite: full profiles, fewer
 * games, and it records per-move cost so latency regressions are visible too.
 *
 * Usage: npx tsx tools/shipArena.ts [positions]
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMove, applyMoves, type GameState } from "@uttt/game-engine";
import { loadArenaPositions } from "../src/arena.js";
import { summarizePairs } from "../src/arenaStats.js";
import { chooseMoveDetailed, DIFFICULTY_PROFILES, type Difficulty } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Cost {
  moves: number;
  nodes: number;
  ms: number;
  depth: number;
  maxMs: number;
}

function emptyCost(): Cost {
  return { moves: 0, nodes: 0, ms: 0, depth: 0, maxMs: 0 };
}

const costs: Record<Difficulty, Cost> = {
  easy: emptyCost(),
  medium: emptyCost(),
  hard: emptyCost(),
};

function playFrom(
  start: GameState,
  x: Difficulty,
  o: Difficulty,
  seed: number,
): "X" | "O" | null {
  let state = start;
  let guard = 0;
  while (state.status === "in_progress" && guard < 90) {
    const difficulty = state.currentPlayer === "X" ? x : o;
    const result = chooseMoveDetailed(state, {
      difficulty,
      seed: seed + guard * 9973,
      useOpenings: false,
      gameId: `ship-${seed}-${difficulty}`,
    });
    const cost = costs[difficulty];
    cost.moves += 1;
    cost.nodes += result.info.nodes;
    cost.ms += result.info.timeMs;
    cost.depth += result.info.depth;
    if (result.info.timeMs > cost.maxMs) cost.maxMs = result.info.timeMs;

    const next = applyMove(state, result.move);
    if (!next.ok) throw new Error(`illegal move from ${difficulty}: ${next.error}`);
    state = next.state;
    guard += 1;
  }
  return state.winner;
}

interface PairingResult {
  candidate: Difficulty;
  baseline: Difficulty;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  elo: number;
  eloCiLow: number;
  eloCiHigh: number;
}

function runPairing(
  candidate: Difficulty,
  baseline: Difficulty,
  starts: GameState[],
  seed: number,
): PairingResult {
  const pairs: { q: number }[] = [];
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const t0 = Date.now();

  for (let i = 0; i < starts.length; i++) {
    let points = 0;
    for (const candIsX of [true, false]) {
      const winner = playFrom(
        starts[i]!,
        candIsX ? candidate : baseline,
        candIsX ? baseline : candidate,
        seed + i * 1009 + (candIsX ? 0 : 1),
      );
      if (winner === null) {
        points += 0.5;
        draws += 1;
      } else if ((winner === "X") === candIsX) {
        points += 1;
        wins += 1;
      } else {
        losses += 1;
      }
    }
    pairs.push({ q: points });
    const played = pairs.length * 2;
    process.stdout.write(
      `  ${candidate} vs ${baseline}: ${String(played).padStart(3)} games ` +
        `W-D-L=${wins}-${draws}-${losses} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
    );
  }

  const report = summarizePairs(pairs, { seed });
  return {
    candidate,
    baseline,
    games: pairs.length * 2,
    wins,
    draws,
    losses,
    score: report.score,
    elo: report.elo,
    eloCiLow: report.eloCiLow,
    eloCiHigh: report.eloCiHigh,
  };
}

function main(): void {
  const count = Number(process.argv[2] ?? 12);
  const starts = loadArenaPositions()
    .filter((p) => p.tag === "early" || p.tag === "mid")
    .slice(0, count)
    .map((p) => {
      const built = applyMoves(p.moves);
      if (!built.ok) throw new Error(built.error);
      return built.state;
    })
    .filter((s) => s.status === "in_progress");

  console.log(`Ship arena at full profiles, ${starts.length} positions x 2 seats\n`);
  const pairings = [
    runPairing("hard", "medium", starts, 101),
    runPairing("medium", "easy", starts, 202),
  ];

  console.log("\nLadder:");
  for (const p of pairings) {
    console.log(
      `  ${p.candidate} vs ${p.baseline}: score=${p.score.toFixed(3)} ` +
        `elo=${p.elo.toFixed(0)} ci=[${p.eloCiLow.toFixed(0)}, ${p.eloCiHigh.toFixed(0)}] ` +
        `W-D-L=${p.wins}-${p.draws}-${p.losses}`,
    );
  }

  console.log("\nPer-move cost:");
  const perMove: Record<string, unknown> = {};
  for (const d of ["easy", "medium", "hard"] as const) {
    const c = costs[d];
    if (c.moves === 0) continue;
    const entry = {
      avgNodes: Math.round(c.nodes / c.moves),
      avgMs: Number((c.ms / c.moves).toFixed(1)),
      maxMs: Number(c.maxMs.toFixed(1)),
      avgDepth: Number((c.depth / c.moves).toFixed(2)),
      profileNodeBudget: DIFFICULTY_PROFILES[d].nodeBudget,
      profileTimeMs: DIFFICULTY_PROFILES[d].timeMs,
    };
    perMove[d] = entry;
    console.log(
      `  ${d.padEnd(7)} nodes=${entry.avgNodes.toLocaleString("en-US")} ` +
        `avg=${entry.avgMs}ms max=${entry.maxMs}ms depth=${entry.avgDepth}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    note: "Measured on the maintainer's machine; ms figures are hardware-specific, nodes and Elo are not.",
    positions: starts.length,
    pairings,
    perMove,
  };
  const path = join(__dirname, "..", "src", "fixtures", "ladder-baseline.json");
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWrote ${path}`);
}

main();
