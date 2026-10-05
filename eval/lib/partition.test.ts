import { describe, expect, it } from "vitest";
import { assignPartitions, overlap } from "./partition";
import type { CohortRound } from "./schemas";

const round = (rank: number, uidNum: number): CohortRound => ({
  rank,
  uid: `CHE${String(uidNum).padStart(9, "0")}`,
  company: `Co ${uidNum} AG`,
  announced: "2026-01-15",
  url: `https://example.test/${rank}`,
  title: `t${rank}`,
});

describe("assignPartitions", () => {
  it("fills spike first, then cohort", () => {
    const r = assignPartitions([round(1, 1), round(2, 2), round(3, 3), round(4, 4)], { spike: 2, cohort: 1 });
    expect(r.spike.map((x) => x.rank)).toEqual([1, 2]);
    expect(r.cohort.map((x) => x.rank)).toEqual([3]);
    expect(r.unused.map((x) => x.rank)).toEqual([4]);
    expect(r.complete).toBe(true);
  });

  it("keeps a company's rounds in one partition", () => {
    const r = assignPartitions([round(1, 1), round(2, 2), round(3, 1), round(4, 3)], { spike: 1, cohort: 2 });
    expect(r.spike.map((x) => x.rank)).toEqual([1, 3]);
    expect(r.cohort.map((x) => x.rank)).toEqual([2, 4]);
    expect(overlap(r.spike.map((x) => x.uid), r.cohort.map((x) => x.uid))).toEqual([]);
  });

  it("reports an incomplete draw", () => {
    expect(assignPartitions([round(1, 1)], { spike: 1, cohort: 1 }).complete).toBe(false);
  });
});
