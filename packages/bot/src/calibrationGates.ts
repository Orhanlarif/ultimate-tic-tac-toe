/**
 * Soft gates for human-facing Easy / Medium calibration targets.
 * Shared by `tools/shipArena.ts` and CI smoke tests.
 */
import type { ProxyId } from "./proxies.js";
import type { Difficulty } from "./types.js";

export type Contender = Difficulty | ProxyId;

export interface CalibrationPairing {
  candidate: Contender;
  baseline: Contender;
  score: number;
  elo: number;
}

/**
 * Failures are returned as warning strings so a noisy short sample does not
 * hard-crash calibration; CI asserts the same bands on a smaller set.
 */
export function evaluateCalibrationGates(
  pairings: CalibrationPairing[],
): string[] {
  const warnings: string[] = [];
  const find = (c: Contender, b: Contender) =>
    pairings.find((p) => p.candidate === c && p.baseline === b);

  const easyVsRandom = find("easy", "random");
  if (easyVsRandom) {
    if (easyVsRandom.score < 0.65) {
      warnings.push(
        `easy vs random score ${easyVsRandom.score.toFixed(3)} < 0.65 (too weak)`,
      );
    }
    if (easyVsRandom.score > 0.98) {
      warnings.push(
        `easy vs random score ${easyVsRandom.score.toFixed(3)} > 0.98 (too crushing / less useful signal)`,
      );
    }
  }

  const easyVsGreedy = find("easy", "greedy1");
  if (easyVsGreedy) {
    // Beginner-friendly: a 1-ply greedy proxy should often beat or draw Easy.
    if (easyVsGreedy.score > 0.55) {
      warnings.push(
        `easy vs greedy1 score ${easyVsGreedy.score.toFixed(3)} > 0.55 (Easy still too strong vs beginner proxy)`,
      );
    }
  }

  const medVsEasy = find("medium", "easy");
  if (medVsEasy) {
    if (medVsEasy.elo < 120) {
      warnings.push(
        `medium vs easy elo ${medVsEasy.elo.toFixed(0)} < 120 (rungs too close)`,
      );
    }
    // Beginner Easy vs a competent Medium naturally leaves a large gap.
    if (medVsEasy.elo > 600) {
      warnings.push(
        `medium vs easy elo ${medVsEasy.elo.toFixed(0)} > 600 (Medium may still feel like a wall after Easy)`,
      );
    }
  }

  const hardVsMed = find("hard", "medium");
  if (hardVsMed && hardVsMed.elo < 150) {
    warnings.push(
      `hard vs medium elo ${hardVsMed.elo.toFixed(0)} < 150 (Hard no longer clearly above Medium)`,
    );
  }

  return warnings;
}
