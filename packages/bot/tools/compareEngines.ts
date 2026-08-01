/**
 * Head-to-head between the working engine (`src/`) and a frozen snapshot
 * (`baseline/`), at an equal node budget so the comparison measures search
 * quality rather than raw speed.
 *
 * Identical engines score exactly 0.500 here, because Hard is deterministic for
 * a given position, so any Elo the tool reports is attributable to your change.
 *
 * Before touching the engine, snapshot it:
 *
 *   mkdir baseline && cp src/*.ts baseline/ && rm baseline/*.test.ts \
 *     baseline/arena.ts baseline/arenaStats.ts baseline/bench.ts \
 *     baseline/calibrate.ts baseline/compare.ts
 *
 * Then: npx tsx tools/compareEngines.ts [nodeBudget] [positions]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMoves, applyMove, type GameState, type Move } from "@uttt/game-engine";
import { summarizePairs } from "../src/arenaStats.js";
import { chooseMove as candidateMove } from "../src/index.js";
// @ts-expect-error - baseline/ is an optional, gitignored engine snapshot.
import { chooseMove as baselineMove } from "../baseline/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Engine = "candidate" | "baseline";

interface Budgets {
  nodeBudget: number;
  timeMs: number;
}

function pick(
  engine: Engine,
  state: GameState,
  seed: number,
  budgets: Budgets,
  gameId: string,
): Move {
  const opts = {
    difficulty: "hard" as const,
    seed,
    timeMs: budgets.timeMs,
    nodeBudget: budgets.nodeBudget,
    useOpenings: false,
    gameId,
  };
  return engine === "candidate" ? candidateMove(state, opts) : baselineMove(state, opts);
}

function playFrom(
  start: GameState,
  xEngine: Engine,
  oEngine: Engine,
  seed: number,
  budgets: Budgets,
): "X" | "O" | null {
  let state = start;
  let guard = 0;
  while (state.status === "in_progress" && guard < 90) {
    const engine = state.currentPlayer === "X" ? xEngine : oEngine;
    const move = pick(
      engine,
      state,
      seed + guard * 9973,
      budgets,
      `cmp-${seed}-${engine}`,
    );
    const next = applyMove(state, move);
    if (!next.ok) throw new Error(`illegal move from ${engine}: ${next.error}`);
    state = next.state;
    guard += 1;
  }
  return state.winner;
}

interface Position {
  id: string;
  tag: string;
  moves: Move[];
}

function main(): void {
  const nodeBudget = Number(process.argv[2] ?? 120_000);
  const limit = Number(process.argv[3] ?? 50);
  const budgets: Budgets = { nodeBudget, timeMs: 120_000 };

  const raw = readFileSync(
    join(__dirname, "..", "src", "fixtures", "arena-50.json"),
    "utf8",
  );
  const positions = (JSON.parse(raw) as Position[]).slice(0, limit);

  const pairs: { q: number }[] = [];
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const t0 = Date.now();

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]!;
    const built = applyMoves(pos.moves);
    if (!built.ok || built.state.status !== "in_progress") continue;

    let points = 0;
    for (const candIsX of [true, false]) {
      const winner = playFrom(
        built.state,
        candIsX ? "candidate" : "baseline",
        candIsX ? "baseline" : "candidate",
        4242 + i * 1009 + (candIsX ? 0 : 1),
        budgets,
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
      `[${String(played).padStart(3)}] ${pos.id.padEnd(12)} ` +
        `W-D-L=${wins}-${draws}-${losses} ` +
        `score=${((wins + draws * 0.5) / played).toFixed(3)} ` +
        `${((Date.now() - t0) / 1000).toFixed(0)}s\n`,
    );
  }

  const report = summarizePairs(pairs, { seed: 7 });
  console.log(
    `\ncandidate vs baseline @ ${nodeBudget.toLocaleString("en-US")} nodes/move`,
  );
  console.log(`games=${pairs.length * 2} W-D-L=${wins}-${draws}-${losses}`);
  console.log(
    `score=${report.score.toFixed(3)} elo=${report.elo.toFixed(1)} ` +
      `ci=[${report.eloCiLow.toFixed(1)}, ${report.eloCiHigh.toFixed(1)}] ` +
      `significant=${report.significant}`,
  );
  console.log(`wall=${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();
