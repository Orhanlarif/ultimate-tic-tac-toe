import type { LeagueTier } from "@uttt/contracts";

export interface RatingState {
  rating: number;
  rd: number;
  volatility: number;
}

export const DEFAULT_RATING: RatingState = {
  rating: 1500,
  rd: 350,
  volatility: 0.06,
};

export const PLACEMENT_GAMES = 5;

const TAU = 0.5;
const EPSILON = 0.000001;
const SCALE = 173.7178;

function toGlicko2(r: RatingState) {
  return {
    mu: (r.rating - 1500) / SCALE,
    phi: r.rd / SCALE,
    sigma: r.volatility,
  };
}

function fromGlicko2(mu: number, phi: number, sigma: number): RatingState {
  return {
    rating: mu * SCALE + 1500,
    rd: phi * SCALE,
    volatility: sigma,
  };
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
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
  const p = toGlicko2(player);
  const o = toGlicko2(opponent);

  const gPhi = g(o.phi);
  const e = E(p.mu, o.mu, o.phi);
  const v = 1 / (gPhi * gPhi * e * (1 - e));
  const delta = v * gPhi * (score - e);

  const a = Math.log(p.sigma * p.sigma);
  const phi = p.phi;
  const tau = TAU;

  function f(x: number): number {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (tau * tau);
  }

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    B = a - k * tau;
    while (f(B) < 0) {
      k += 1;
      B = a - k * tau;
    }
  }

  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }

  const sigmaPrime = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = p.mu + phiPrime * phiPrime * gPhi * (score - e);

  return fromGlicko2(muPrime, phiPrime, sigmaPrime);
}

export function scoreFromResult(
  youAre: "X" | "O",
  result: "X" | "O" | "draw",
): 0 | 0.5 | 1 {
  if (result === "draw") return 0.5;
  return result === youAre ? 1 : 0;
}

export function leagueFromRating(rating: number): LeagueTier {
  if (rating < 1200) return "bronze";
  if (rating < 1400) return "silver";
  if (rating < 1600) return "gold";
  if (rating < 1800) return "platinum";
  if (rating < 2000) return "diamond";
  if (rating < 2200) return "master";
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
  const resultForB = (1 - resultForA) as 0 | 0.5 | 1;
  return {
    a: updateRating(a, b, resultForA),
    b: updateRating(b, a, resultForB),
  };
}
