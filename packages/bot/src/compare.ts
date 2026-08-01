/**
 * A/B harness: play two arbitrary engine profiles against each other over the
 * fixed arena corpus with seat swapping, and report a paired-bootstrap Elo.
 *
 * Usage: npm run compare -w @uttt/bot
 */
import { applyMove, applyMoves, type GameState } from "@uttt/game-engine";
import { loadArenaPositions } from "./arena.js";
import { summarizePairs, type PairScore } from "./arenaStats.js";
import { DIFFICULTY_PROFILES } from "./difficulty.js";
import { createRng } from "./index.js";
import { searchBestMove } from "./search.js";
import { BotSearchSession } from "./session.js";
import type { DifficultyProfile } from "./types.js";

export interface Contender {
  name: string;
  profile: DifficultyProfile;
  timeMs: number;
  nodeBudget: number;
  maxDepth: number;
}

function playGame(
  start: GameState,
  x: Contender,
  o: Contender,
  seed: number,
): "X" | "O" | null {
  let state = start;
  let guard = 0;
  const sessions = {
    X: new BotSearchSession(x.profile.ttSizePower),
    O: new BotSearchSession(o.profile.ttSizePower),
  };

  while (state.status === "in_progress" && guard < 90) {
    const side = state.currentPlayer;
    const who = side === "X" ? x : o;
    const result = searchBestMove(state, who.profile, createRng(seed + guard * 9973), {
      timeMs: who.timeMs,
      maxDepth: who.maxDepth,
      nodeBudget: who.nodeBudget,
      session: sessions[side],
      gameId: `cmp-${seed}`,
      botPlayer: side,
    });
    const next = applyMove(state, result.move);
    if (!next.ok) throw new Error(`illegal move: ${next.error}`);
    state = next.state;
    guard += 1;
  }
  return state.winner;
}

export function compareContenders(
  candidate: Contender,
  baseline: Contender,
  positions: number,
  seed = 12345,
): void {
  const corpus = loadArenaPositions().slice(0, positions);
  const pairs: PairScore[] = [];
  let games = 0;

  for (let i = 0; i < corpus.length; i++) {
    const built = applyMoves(corpus[i]!.moves);
    if (!built.ok) continue;
    let points = 0;
    for (const candIsX of [true, false]) {
      const winner = playGame(
        built.state,
        candIsX ? candidate : baseline,
        candIsX ? baseline : candidate,
        seed + i * 1009 + (candIsX ? 0 : 1),
      );
      games += 1;
      if (winner === null) points += 0.5;
      else if ((winner === "X") === candIsX) points += 1;
    }
    pairs.push({ q: points });
    process.stdout.write(
      `\r  ${i + 1}/${corpus.length} positions, ${games} games…`,
    );
  }
  process.stdout.write("\n");

  const r = summarizePairs(pairs, { seed });
  console.log(
    `${candidate.name} vs ${baseline.name}: games=${games} score=${r.score.toFixed(3)} elo=${r.elo.toFixed(1)} ci=[${r.eloCiLow.toFixed(1)}, ${r.eloCiHigh.toFixed(1)}] significant=${r.significant}`,
  );
  console.log("  pentanomial", r.pentanomial);
}

const hard = DIFFICULTY_PROFILES.hard;

function hardAt(name: string, timeMs: number, nodeBudget: number): Contender {
  return { name, profile: hard, timeMs, maxDepth: hard.maxDepth, nodeBudget };
}

/** How much strength does doubling Hard's search budget actually buy? */
function budgetMode(positions: number): void {
  compareContenders(
    hardAt("hard-2x", 800, 200_000),
    hardAt("hard-1x", 400, 100_000),
    positions,
  );
}

/** Current engine against the configuration it replaced, at equal budgets. */
function upgradeMode(positions: number): void {
  const legacy: Contender = {
    name: "hard-legacy-config",
    profile: {
      ...hard,
      maxDepth: 8,
      qDepth: 6,
      maxExtensions: 0,
      endgameEmptyAuto: 10,
      endgameEmptyTry: 12,
    },
    timeMs: 1_000,
    maxDepth: 8,
    nodeBudget: 250_000,
  };
  compareContenders(hardAt("hard-current", 1_000, 250_000), legacy, positions);
}

function main(): void {
  const mode = process.argv[2] ?? "upgrade";
  const positions = Number(process.argv[3] ?? 20);
  console.log(`Comparing (${mode}) over ${positions} positions × 2 seats…`);
  if (mode === "budget") budgetMode(positions);
  else upgradeMode(positions);
}

main();
