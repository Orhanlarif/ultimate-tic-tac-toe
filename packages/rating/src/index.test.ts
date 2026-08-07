import { describe, expect, it } from "vitest";
import {
  BASE_CHANGE,
  DEFAULT_RATING,
  DRAW_CHANGE,
  applyMutualUpdate,
  leagueFromRating,
  ratingChange,
  scoreFromResult,
  updateRating,
} from "./index.js";

describe("fixed-delta rating", () => {
  it("starts at 300", () => {
    expect(DEFAULT_RATING.rating).toBe(300);
  });

  it("equal players exchange ±40", () => {
    const a = { ...DEFAULT_RATING };
    const b = { ...DEFAULT_RATING };
    const next = applyMutualUpdate(a, b, 1);
    expect(next.a.rating - a.rating).toBe(BASE_CHANGE);
    expect(next.b.rating - b.rating).toBe(-BASE_CHANGE);
  });

  it("mild upset: 250 beats 350 → +43 / −43", () => {
    const underdog = { ...DEFAULT_RATING, rating: 250 };
    const favorite = { ...DEFAULT_RATING, rating: 350 };
    const next = applyMutualUpdate(underdog, favorite, 1);
    expect(next.a.rating - underdog.rating).toBe(43);
    expect(next.b.rating - favorite.rating).toBe(-43);
  });

  it("caps extreme upset at ±45 even with huge gap", () => {
    expect(ratingChange(150, 650, 1)).toBe(45);
    expect(ratingChange(650, 150, 0)).toBe(-45);

    const underdog = { ...DEFAULT_RATING, rating: 150 };
    const favorite = { ...DEFAULT_RATING, rating: 650 };
    const next = applyMutualUpdate(underdog, favorite, 1);
    expect(next.a.rating - underdog.rating).toBe(45);
    expect(next.b.rating - favorite.rating).toBe(-45);
  });

  it("favorite win is capped at ±35", () => {
    expect(ratingChange(650, 150, 1)).toBe(35);
    expect(ratingChange(150, 650, 0)).toBe(-35);

    const favorite = { ...DEFAULT_RATING, rating: 650 };
    const underdog = { ...DEFAULT_RATING, rating: 150 };
    const next = applyMutualUpdate(favorite, underdog, 1);
    expect(next.a.rating - favorite.rating).toBe(35);
    expect(next.b.rating - underdog.rating).toBe(-35);
  });

  it("draw gives +20 to both", () => {
    const a = { ...DEFAULT_RATING, rating: 250 };
    const b = { ...DEFAULT_RATING, rating: 400 };
    const next = applyMutualUpdate(a, b, 0.5);
    expect(next.a.rating - a.rating).toBe(DRAW_CHANGE);
    expect(next.b.rating - b.rating).toBe(DRAW_CHANGE);
  });

  it("does not go below 0", () => {
    const weak = { ...DEFAULT_RATING, rating: 10 };
    const strong = { ...DEFAULT_RATING, rating: 500 };
    const next = updateRating(weak, strong, 0);
    expect(next.rating).toBe(0);
  });
});

describe("helpers", () => {
  it("maps results and leagues from rating only", () => {
    expect(scoreFromResult("X", "X")).toBe(1);
    expect(scoreFromResult("X", "O")).toBe(0);
    expect(scoreFromResult("O", "draw")).toBe(0.5);
    expect(leagueFromRating(149)).toBe("bronze");
    expect(leagueFromRating(150)).toBe("silver");
    expect(leagueFromRating(300)).toBe("gold");
    expect(leagueFromRating(450)).toBe("diamond");
    expect(leagueFromRating(700)).toBe("grandmaster");
  });
});
