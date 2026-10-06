// The shared precision sample (plan metric table; CEO S1/S1b/X2, eng V7): one seeded sample of
// n = 30 from the union of both systems' holdout positives, stratified by which system flagged
// the increase, with at least 10 items per system. Precision is then weighted by stratum
// population (lib/domain/metrics weightedPrecision).
import type { PrecisionStratum } from "../../lib/domain/metrics";
import { seededShuffle } from "./seeded";

export const STRATA = ["both", "rules_only", "claude_only"] as const;
export type Stratum = (typeof STRATA)[number];
export type Populations = Record<Stratum, number>;
export type Allocation = Record<Stratum, number>;
export const PRECISION_N = 30;
export const PER_SYSTEM_MIN = 10;

const rulesN = (a: Allocation) => a.both + a.rules_only;
const claudeN = (a: Allocation) => a.both + a.claude_only;

export const stratumOf = (rulesPositive: boolean, claudePositive: boolean): Stratum | null =>
  rulesPositive && claudePositive ? "both" : rulesPositive ? "rules_only" : claudePositive ? "claude_only" : null;

/**
 * The allocation closest to proportional (least squares) among those that give each system at
 * least `min` items (or all of its positives when it has fewer). Exhaustive over n ≤ 30, so the
 * result is deterministic and easy to audit; ties go to the first found (both, rules, claude order).
 */
export function allocate(pop: Populations, n = PRECISION_N, min = PER_SYSTEM_MIN): Allocation {
  const total = STRATA.reduce((s, k) => s + pop[k], 0);
  const size = Math.min(n, total);
  const target = (k: Stratum) => (total ? (size * pop[k]) / total : 0);
  const needRules = Math.min(min, pop.both + pop.rules_only);
  const needClaude = Math.min(min, pop.both + pop.claude_only);
  let best: Allocation | null = null;
  let bestCost = Infinity;
  for (let b = 0; b <= Math.min(size, pop.both); b++) {
    for (let r = 0; r <= Math.min(size - b, pop.rules_only); r++) {
      const c = size - b - r;
      if (c > pop.claude_only) continue;
      const a: Allocation = { both: b, rules_only: r, claude_only: c };
      if (rulesN(a) < needRules || claudeN(a) < needClaude) continue;
      // Every non-empty stratum needs a sampled item, or its weighted share has no estimate.
      if (STRATA.some((k) => pop[k] > 0 && a[k] === 0 && size >= STRATA.filter((s) => pop[s] > 0).length)) continue;
      const cost = STRATA.reduce((s, k) => s + (a[k] - target(k)) ** 2, 0);
      if (cost < bestCost - 1e-9) [best, bestCost] = [a, cost];
    }
  }
  if (!best) throw new Error(`no allocation of ${size} meets ${min} per system for populations ${JSON.stringify(pop)}`);
  return best;
}

/** Seeded draw within each stratum; items keep the order the shuffle gives them. */
export function drawSample<T extends { key: string; stratum: Stratum }>(items: readonly T[], alloc: Allocation, seed: number): T[] {
  const sorted = [...items].sort((p, q) => p.key.localeCompare(q.key));
  return STRATA.flatMap((s) => seededShuffle(sorted.filter((i) => i.stratum === s), seed).slice(0, alloc[s]));
}

export type Verdict = "verified" | "refuted" | "unverifiable";

/** Per-system strata for weightedPrecision: a system's positives are "both" plus its own stratum. */
export function systemStrata(pop: Populations, verdicts: readonly { stratum: Stratum; verdict: Verdict }[], system: "rules" | "claude"): PrecisionStratum[] {
  const own: Stratum = system === "rules" ? "rules_only" : "claude_only";
  return (["both", own] as const).map((s) => {
    const v = verdicts.filter((x) => x.stratum === s);
    return { population: pop[s], verified: v.filter((x) => x.verdict === "verified").length, refuted: v.filter((x) => x.verdict === "refuted").length, unverifiable: v.filter((x) => x.verdict === "unverifiable").length };
  });
}
