// Spike / recall-cohort assignment, grouped by company (eng V4): walk eligible rounds in
// seeded order; a company already assigned keeps its partition; otherwise fill the spike
// set first, then the cohort.
import type { CohortRound } from "./schemas";

export const SPIKE_QUOTA = 20;
export const COHORT_QUOTA = 30;

export interface PartitionResult {
  spike: CohortRound[];
  cohort: CohortRound[];
  /** Eligible rounds after both quotas were full (screening went further than needed). */
  unused: CohortRound[];
  complete: boolean;
}

export function assignPartitions(
  eligibleInRankOrder: readonly CohortRound[],
  quotas = { spike: SPIKE_QUOTA, cohort: COHORT_QUOTA },
): PartitionResult {
  const spike: CohortRound[] = [];
  const cohort: CohortRound[] = [];
  const unused: CohortRound[] = [];
  const owner = new Map<string, "spike" | "cohort">();
  for (const round of eligibleInRankOrder) {
    const known = owner.get(round.uid);
    if (known === "spike") spike.push(round);
    else if (known === "cohort") cohort.push(round);
    else if (spike.length < quotas.spike) {
      owner.set(round.uid, "spike");
      spike.push(round);
    } else if (cohort.length < quotas.cohort) {
      owner.set(round.uid, "cohort");
      cohort.push(round);
    } else unused.push(round);
  }
  return {
    spike,
    cohort,
    unused,
    complete: spike.length >= quotas.spike && cohort.length >= quotas.cohort,
  };
}

/** UIDs present in both lists: must be empty for cohort vs. inspected ledger. */
export function overlap(a: Iterable<string>, b: Iterable<string>): string[] {
  const set = new Set(a);
  return [...new Set(b)].filter((x) => set.has(x));
}
