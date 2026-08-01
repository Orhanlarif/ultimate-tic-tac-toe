import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATING,
  applyMutualUpdate,
  leagueFromRating,
  scoreFromResult,
  updateRating,
} from "./index.js";

describe("glicko-2", () => {
  it("increases winner rating and decreases loser", () => {
    const a = { ...DEFAULT_RATING };
    const b = { ...DEFAULT_RATING };
    const next = applyMutualUpdate(a, b, 1);
    expect(next.a.rating).toBeGreaterThan(a.rating);
    expect(next.b.rating).toBeLessThan(b.rating);
    expect(next.a.rd).toBeLessThan(a.rd);
  });

  it("draw keeps ratings close", () => {
    const a = { ...DEFAULT_RATING };
    const b = { ...DEFAULT_RATING };
    const next = applyMutualUpdate(a, b, 0.5);
    expect(Math.abs(next.a.rating - next.b.rating)).toBeLessThan(1);
  });

  it("upsets give larger swings", () => {
    const underdog = { rating: 1200, rd: 100, volatility: 0.06 };
    const favorite = { rating: 1800, rd: 100, volatility: 0.06 };
    const win = updateRating(underdog, favorite, 1);
    const expected = updateRating(underdog, { ...DEFAULT_RATING, rd: 100 }, 1);
    expect(win.rating - underdog.rating).toBeGreaterThan(
      expected.rating - underdog.rating,
    );
  });
});

describe("helpers", () => {
  it("maps results and leagues", () => {
    expect(scoreFromResult("X", "X")).toBe(1);
    expect(scoreFromResult("X", "O")).toBe(0);
    expect(scoreFromResult("O", "draw")).toBe(0.5);
    expect(leagueFromRating(1500, true)).toBe("gold");
    expect(leagueFromRating(1500, false)).toBe("bronze");
  });
});
