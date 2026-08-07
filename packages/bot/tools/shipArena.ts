/**
 * Ladder calibration at the profiles players actually get, plus weak human
 * proxies so Easy/Medium can be judged against beginner-facing baselines.
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
import {
  chooseMoveDetailed,
  DIFFICULTY_PROFILES,
  evaluateCalibrationGates,
  type Difficulty,
} from "../src/index.js";
import {
  chooseProxyMove,
  isProxyId,
} from "../src/proxies.js";
import type { Contender } from "../src/calibrationGates.js";

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

function isDifficulty(c: Contender): c is Difficulty {
  return c === "easy" || c === "medium" || c === "hard";
}

function pickMove(
  state: GameState,
  contender: Contender,
  seed: number,
): { move: ReturnType<typeof chooseProxyMove>; nodes: number; ms: number; depth: number } {
  if (isProxyId(contender)) {
    return {
      move: chooseProxyMove(state, contender, seed),
      nodes: 0,
      ms: 0,
      depth: 0,
    };
  }
  const result = chooseMoveDetailed(state, {
    difficulty: contender,
    seed,
    useOpenings: false,
    gameId: `ship-${seed}-${contender}`,
  });
  return {
    move: result.move,
    nodes: result.info.nodes,
    ms: result.info.timeMs,
    depth: result.info.depth,
  };
}

function playFrom(
  start: GameState,
  x: Contender,
  o: Contender,
  seed: number,
): "X" | "O" | null {
  let state = start;
  let guard = 0;
  while (state.status === "in_progress" && guard < 90) {
    const contender = state.currentPlayer === "X" ? x : o;
    const picked = pickMove(state, contender, seed + guard * 9973);
    if (isDifficulty(contender)) {
      const cost = costs[contender];
      cost.moves += 1;
      cost.nodes += picked.nodes;
      cost.ms += picked.ms;
      cost.depth += picked.depth;
      if (picked.ms > cost.maxMs) cost.maxMs = picked.ms;
    }

    const next = applyMove(state, picked.move);
    if (!next.ok) {
      throw new Error(`illegal move from ${contender}: ${next.error}`);
    }
    state = next.state;
    guard += 1;
  }
  return state.winner;
}

interface PairingResult {
  candidate: Contender;
  baseline: Contender;
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
  candidate: Contender,
  baseline: Contender,
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
    runPairing("easy", "random", starts, 303),
    runPairing("easy", "greedy1", starts, 404),
    runPairing("medium", "greedy1", starts, 505),
    runPairing("easy", "shallowNoGuard", starts, 606),
  ];

  console.log("\nLadder:");
  for (const p of pairings) {
    console.log(
      `  ${p.candidate} vs ${p.baseline}: score=${p.score.toFixed(3)} ` +
        `elo=${p.elo.toFixed(0)} ci=[${p.eloCiLow.toFixed(0)}, ${p.eloCiHigh.toFixed(0)}] ` +
        `W-D-L=${p.wins}-${p.draws}-${p.losses}`,
    );
  }

  const warnings = evaluateCalibrationGates(pairings);
  if (warnings.length > 0) {
    console.log("\nCalibration warnings:");
    for (const w of warnings) console.log(`  ! ${w}`);
  } else {
    console.log("\nCalibration gates: ok");
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
    note: "Measured on the maintainer's machine; ms figures are hardware-specific, nodes and Elo are not. Proxy pairings (random/greedy1/shallowNoGuard) gauge human-facing Easy/Medium targets.",
    positions: starts.length,
    pairings,
    gates: warnings,
    perMove,
    profiles: {
      easy: {
        maxDepth: DIFFICULTY_PROFILES.easy.maxDepth,
        softBlunderRate: DIFFICULTY_PROFILES.easy.softBlunderRate,
        trustTacticalShortcuts: DIFFICULTY_PROFILES.easy.trustTacticalShortcuts,
        allowUnsafeBlunders: DIFFICULTY_PROFILES.easy.allowUnsafeBlunders,
      },
      medium: {
        maxDepth: DIFFICULTY_PROFILES.medium.maxDepth,
        softBlunderRate: DIFFICULTY_PROFILES.medium.softBlunderRate,
        candidateWindow: DIFFICULTY_PROFILES.medium.candidateWindow,
      },
      hard: {
        nodeBudget: DIFFICULTY_PROFILES.hard.nodeBudget,
        timeMs: DIFFICULTY_PROFILES.hard.timeMs,
      },
    },
  };
  const path = join(__dirname, "..", "src", "fixtures", "ladder-baseline.json");
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nWrote ${path}`);
}

main();
