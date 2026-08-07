/**
 * Offline strength calibration / Elo arena.
 *
 * Usage:
 *   npm run calibrate -w @uttt/bot
 *   npm run arena:quick -w @uttt/bot
 *   npm run arena:full -w @uttt/bot
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArena50, loadArenaPositions, runArena } from "./arena.js";
import { DIFFICULTY_PROFILES } from "./difficulty.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function dumpFixtures(): void {
  const positions = buildArena50();
  const path = join(__dirname, "fixtures", "arena-50.json");
  writeFileSync(path, JSON.stringify(positions, null, 2));
  console.log(`Wrote ${positions.length} positions to ${path}`);
}

function runFullArena(mode: "quick" | "full"): void {
  const positions = loadArenaPositions();
  const quick = mode === "quick";
  const config = {
    candidate: "hard" as const,
    baseline: "medium" as const,
    budgetScale: quick ? 0.12 : 0.35,
    timeMs: quick ? 120 : 400,
    seed: 42,
  };
  console.log(
    `Arena ${mode}: hard vs medium, ${positions.length} positions × 2 seats…`,
  );
  const result = runArena(positions, config);
  const r = result.report;
  console.log(
    `games=${result.games} illegal=${result.illegal} score=${r.score.toFixed(3)} elo=${r.elo.toFixed(1)} ci=[${r.eloCiLow.toFixed(1)}, ${r.eloCiHigh.toFixed(1)}] significant=${r.significant}`,
  );
  console.log("pentanomial", r.pentanomial);

  const easyMed = runArena(positions.slice(0, quick ? 12 : 50), {
    candidate: "medium",
    baseline: "easy",
    budgetScale: quick ? 0.14 : 0.4,
    timeMs: quick ? 90 : 280,
    seed: 43,
  });
  console.log(
    `medium vs easy: elo=${easyMed.report.elo.toFixed(1)} ci=[${easyMed.report.eloCiLow.toFixed(1)}, ${easyMed.report.eloCiHigh.toFixed(1)}] significant=${easyMed.report.significant}`,
  );

  console.log("\nProfiles:");
  for (const d of ["easy", "medium", "hard"] as const) {
    const p = DIFFICULTY_PROFILES[d];
    console.log(
      `  ${d}: depth=${p.maxDepth} nodes=${p.nodeBudget} pvs=${p.usePvs} lmr=${p.useLmr} q=${p.qDepth} eg=${p.endgameEmptyAuto}/${p.endgameEmptyTry} blunder=${p.softBlunderRate} shortcuts=${p.trustTacticalShortcuts} unsafeBlunders=${p.allowUnsafeBlunders} bookPrincipal=${p.openingPrincipal}`,
    );
  }
}

const cmd = process.argv[2] ?? "full";
if (cmd === "fixtures") dumpFixtures();
else if (cmd === "quick") runFullArena("quick");
else runFullArena("full");
