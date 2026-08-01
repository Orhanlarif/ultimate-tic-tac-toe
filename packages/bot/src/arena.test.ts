import { describe, expect, it } from "vitest";
import { applyMoves } from "@uttt/game-engine";
import { buildArena50, loadArenaPositions, runArena } from "./arena";
import { scoreToElo, summarizePairs } from "./arenaStats";

describe("arena corpus", () => {
  it("builds 50 legal in-progress positions", () => {
    const positions = buildArena50();
    expect(positions.length).toBe(50);
    for (const p of positions) {
      const built = applyMoves(p.moves);
      expect(built.ok).toBe(true);
      if (built.ok) expect(built.state.status).toBe("in_progress");
    }
  });

  it("loads the checked-in fixture corpus", () => {
    const positions = loadArenaPositions();
    expect(positions.length).toBe(50);
    expect(positions[0]?.moves.length).toBeGreaterThan(0);
  });
});

describe("arena stats", () => {
  it("marks clearly stronger candidates as significant", () => {
    const pairs = Array.from({ length: 50 }, () => ({ q: 2 }));
    const report = summarizePairs(pairs, { bootstrapSamples: 2000, seed: 1 });
    expect(report.significant).toBe(true);
    expect(report.eloCiLow).toBeGreaterThan(0);
  });

  it("maps even score near zero elo", () => {
    expect(Math.abs(scoreToElo(0.5))).toBeLessThan(1);
  });
});

describe("arena quick smoke", () => {
  it("runs a tiny seat-swapped sample without illegal moves", () => {
    const positions = loadArenaPositions().slice(0, 2);
    const result = runArena(positions, {
      candidate: "hard",
      baseline: "easy",
      budgetScale: 0.1,
      timeMs: 80,
      seed: 77,
    });
    expect(result.games).toBe(4);
    expect(result.illegal).toBe(0);
  }, 45_000);
});
