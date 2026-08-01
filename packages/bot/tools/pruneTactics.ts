/**
 * Drops tactical cases where winning is not a narrow choice, so the corpus keeps
 * its discriminating power. Run after `genTactics.ts` if the constraints change.
 *
 * Usage: npx tsx tools/pruneTactics.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMoves, getLegalMoves, type Move, type Player } from "@uttt/game-engine";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TacticCase {
  id: string;
  moves: Move[];
  sideToMove: Player;
  winningMoves: Move[];
  mateIn: number;
}

const path = join(__dirname, "..", "src", "fixtures", "tactics.json");
const cases = JSON.parse(readFileSync(path, "utf8")) as TacticCase[];

const kept: TacticCase[] = [];
for (const c of cases) {
  const built = applyMoves(c.moves);
  if (!built.ok || built.state.status !== "in_progress") continue;
  const legal = getLegalMoves(built.state).length;
  if (legal < 4 || c.winningMoves.length > legal / 2) {
    console.log(
      `drop ${c.id}: ${c.winningMoves.length}/${legal} moves win — too loose`,
    );
    continue;
  }
  kept.push({ ...c, id: `mate-${String(kept.length).padStart(2, "0")}` });
}

writeFileSync(path, `${JSON.stringify(kept, null, 2)}\n`);
console.log(`\nKept ${kept.length} of ${cases.length} cases`);
