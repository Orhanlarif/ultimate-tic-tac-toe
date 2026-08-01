export interface PairScore {
  /** Candidate points from the two seat-swapped games in [0, 2]. */
  q: number;
}

export interface EloReport {
  score: number;
  wins: number;
  draws: number;
  losses: number;
  elo: number;
  eloCiLow: number;
  eloCiHigh: number;
  significant: boolean;
  pentanomial: Record<string, number>;
}

export function scoreToElo(score: number): number {
  const s = Math.min(0.999, Math.max(0.001, score));
  return 400 * Math.log10(s / (1 - s));
}

export function summarizePairs(
  pairs: PairScore[],
  opts?: { bootstrapSamples?: number; seed?: number },
): EloReport {
  const samples = opts?.bootstrapSamples ?? 20_000;
  const seed = opts?.seed ?? 42;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const pentanomial: Record<string, number> = {
    "0": 0,
    "0.5": 0,
    "1": 0,
    "1.5": 0,
    "2": 0,
  };

  let total = 0;
  for (const p of pairs) {
    total += p.q;
    const key = String(p.q);
    pentanomial[key] = (pentanomial[key] ?? 0) + 1;
    // Approximate WDL from pair average
    if (p.q >= 1.5) wins += 1;
    else if (p.q <= 0.5) losses += 1;
    else draws += 1;
  }

  const n = pairs.length || 1;
  // Jeffreys-style smoothing for Elo
  const score = (total + 0.5) / (2 * n + 1);
  const elo = scoreToElo(score);

  const rng = mulberry(seed);
  const boot: number[] = [];
  for (let i = 0; i < samples; i++) {
    let s = 0;
    for (let j = 0; j < pairs.length; j++) {
      const idx = Math.floor(rng() * pairs.length);
      s += pairs[idx]!.q;
    }
    boot.push(scoreToElo((s + 0.5) / (2 * pairs.length + 1)));
  }
  boot.sort((a, b) => a - b);
  const lo = boot[Math.floor(0.025 * boot.length)] ?? elo;
  const hi = boot[Math.floor(0.975 * boot.length)] ?? elo;

  return {
    score,
    wins,
    draws,
    losses,
    elo,
    eloCiLow: lo,
    eloCiHigh: hi,
    significant: lo > 0,
    pentanomial,
  };
}

function mulberry(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
