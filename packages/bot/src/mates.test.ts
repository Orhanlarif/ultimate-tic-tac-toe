import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyMoves, type Move, type Player } from "@uttt/game-engine";
import { chooseMoveDetailed } from "./index";

/**
 * Forced meta wins that a 6k-node search misses but the shipped Hard search
 * finds, kept only where fewer than half the legal moves win so a degraded
 * search cannot pass by luck. Regenerate with `npx tsx tools/genTactics.ts`
 * followed by `npx tsx tools/pruneTactics.ts`.
 *
 * The budget is expressed in nodes with an effectively unlimited clock, so the
 * result is identical on fast and slow machines. It is deliberately well below
 * what it takes to *prove* the longer mates — the assertion is that the search
 * still steers into them.
 */
const BUDGET = { nodeBudget: 250_000, maxDepth: 60, timeMs: 600_000 };

interface TacticCase {
  id: string;
  moves: Move[];
  sideToMove: Player;
  winningMoves: Move[];
  mateIn: number;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "tactics.json"), "utf8"),
) as TacticCase[];

describe("forced meta wins", () => {
  it("has a non-trivial corpus", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of cases) {
    it(`${c.id} (${c.sideToMove} mates in ${c.mateIn})`, () => {
      const built = applyMoves(c.moves);
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error(built.error);

      const result = chooseMoveDetailed(built.state, {
        difficulty: "hard",
        seed: 3,
        useOpenings: false,
        ...BUDGET,
      });

      const found = c.winningMoves.some(
        (m) => m.board === result.move.board && m.cell === result.move.cell,
      );
      expect(
        found,
        `played ${JSON.stringify(result.move)}, expected one of ` +
          `${JSON.stringify(c.winningMoves)} (score=${result.info.score}, depth=${result.info.depth})`,
      ).toBe(true);
      expect(result.info.score).toBeGreaterThan(0);
    });
  }
});
