import type { LeagueTier } from "@uttt/contracts";

export interface RatingState {
  rating: number;
  /** Kept for DB/API compatibility; unused by the fixed-delta system. */
  rd: number;
  /** Kept for DB/API compatibility; unused by the fixed-delta system. */
  volatility: number;
}

/** Everyone starts here. */
export const DEFAULT_RATING: RatingState = {
  rating: 300,
  rd: 350,
  volatility: 0.06,
};

export const PLACEMENT_GAMES = 5;

/** Points exchanged between equal players on a decisive result. */
export const BASE_CHANGE = 40;

/** Both players receive this on a draw. */
export const DRAW_CHANGE = 20;

/**
 * Extra points per 1 rating difference vs opponent (3 per 100).
 * Capped so underdog wins are at most +45 and favorites at most +35.
 */
export const DIFF_FACTOR = 0.03;
export const MAX_DIFF_ADJ = 5;

function clampAdj(value: number): number {
  return Math.max(-MAX_DIFF_ADJ, Math.min(MAX_DIFF_ADJ, value));
}

/**
 * Rating change for one player after a game.
 * score: 1 win, 0.5 draw, 0 loss
 *
 * Equal players: ±40. Diff adjusts by ~3 per 100 rating, capped at ±5
 * (so max upset is +45/−45 and max expected win is +35/−35). Draws: +20 each.
 */
export function ratingChange(
  playerRating: number,
  opponentRating: number,
  score: 0 | 0.5 | 1,
): number {
  if (score === 0.5) return DRAW_CHANGE;

  const adj = clampAdj(
    Math.round((opponentRating - playerRating) * DIFF_FACTOR),
  );
  if (score === 1) return BASE_CHANGE + adj;
  return -(BASE_CHANGE - adj);
}

/**
 * Update rating after a single game.
 * score: 1 win, 0.5 draw, 0 loss
 */
export function updateRating(
  player: RatingState,
  opponent: RatingState,
  score: 0 | 0.5 | 1,
): RatingState {
  const delta = ratingChange(player.rating, opponent.rating, score);
  return {
    rating: Math.max(0, player.rating + delta),
    rd: player.rd,
    volatility: player.volatility,
  };
}

export function scoreFromResult(
  youAre: "X" | "O",
  result: "X" | "O" | "draw",
): 0 | 0.5 | 1 {
  if (result === "draw") return 0.5;
  return result === youAre ? 1 : 0;
}

/** League bands scaled for a 300 starting rating. */
export function leagueFromRating(rating: number): LeagueTier {
  if (rating < 150) return "bronze";
  if (rating < 250) return "silver";
  if (rating < 350) return "gold";
  if (rating < 450) return "platinum";
  if (rating < 550) return "diamond";
  if (rating < 700) return "master";
  return "grandmaster";
}

export function visibleRating(state: RatingState): number {
  return Math.round(state.rating);
}

export function applyMutualUpdate(
  a: RatingState,
  b: RatingState,
  resultForA: 0 | 0.5 | 1,
): { a: RatingState; b: RatingState } {
  if (resultForA === 0.5) {
    return {
      a: updateRating(a, b, 0.5),
      b: updateRating(b, a, 0.5),
    };
  }
  const resultForB = (1 - resultForA) as 0 | 1;
  return {
    a: updateRating(a, b, resultForA),
    b: updateRating(b, a, resultForB),
  };
}
