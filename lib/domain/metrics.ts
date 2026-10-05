// Eval statistics (plan metric table; CEO X2, eng V7). Precision is weighted by stratum
// population; sampling uncertainty uses boundary-safe per-stratum Wilson intervals combined
// with the same weights (no bootstrap); unverifiable labels are reported as bounds.

export interface Interval {
  lo: number;
  hi: number;
}

/** Wilson score interval for k successes in n trials. n = 0 → the uninformative [0, 1]. */
export function wilson(k: number, n: number, z = 1.959963984540054): Interval {
  if (n === 0) return { lo: 0, hi: 1 };
  if (k < 0 || k > n) throw new Error(`wilson: k=${k} outside 0..${n}`);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // Exact at the boundaries (float error would otherwise give 0.9999…).
  return { lo: k === 0 ? 0 : Math.max(0, center - half), hi: k === n ? 1 : Math.min(1, center + half) };
}

export interface PrecisionStratum {
  /** Holdout positives in this stratum (the population the sample stands for). */
  population: number;
  verified: number;
  refuted: number;
  unverifiable: number;
}

export interface WeightedPrecision {
  /** Point estimates: unverifiable counted as false (low) and as true (high). */
  estimate: Interval;
  /** Combined Wilson bounds: low side from the pessimistic, high side from the optimistic count. */
  interval: Interval;
  n: number;
}

export function weightedPrecision(strata: readonly PrecisionStratum[]): WeightedPrecision {
  const live = strata.filter((s) => s.population > 0);
  const total = live.reduce((a, s) => a + s.population, 0);
  if (total === 0) throw new Error("weightedPrecision: no positives in any stratum");
  let estLo = 0;
  let estHi = 0;
  let ciLo = 0;
  let ciHi = 0;
  let n = 0;
  for (const s of live) {
    const sampled = s.verified + s.refuted + s.unverifiable;
    if (sampled === 0) throw new Error("weightedPrecision: a stratum with positives has no sampled items");
    const w = s.population / total;
    estLo += (w * s.verified) / sampled;
    estHi += (w * (s.verified + s.unverifiable)) / sampled;
    ciLo += w * wilson(s.verified, sampled).lo;
    ciHi += w * wilson(s.verified + s.unverifiable, sampled).hi;
    n += sampled;
  }
  return { estimate: { lo: estLo, hi: estHi }, interval: { lo: ciLo, hi: ciHi }, n };
}

export interface Recall {
  detected: number;
  cohort: number;
  rate: number;
  interval: Interval;
}

export function recall(detected: number, cohort: number): Recall {
  return { detected, cohort, rate: cohort ? detected / cohort : 0, interval: wilson(detected, cohort) };
}
