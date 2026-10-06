import { describe, expect, it } from "vitest";
import { allocate, drawSample, stratumOf, systemStrata } from "./precision";

describe("precision sample allocation", () => {
  it("is proportional when both systems already get 10", () => {
    expect(allocate({ both: 60, rules_only: 30, claude_only: 30 })).toEqual({ both: 15, rules_only: 7, claude_only: 8 }) // tie 7.5/7.5: first found;
  });
  it("tops up a small system to 10 at the cost of the others", () => {
    const a = allocate({ both: 5, rules_only: 200, claude_only: 20 });
    expect(a.both + a.claude_only).toBeGreaterThanOrEqual(10);
    expect(a.both + a.rules_only).toBeGreaterThanOrEqual(10);
    expect(a.both + a.rules_only + a.claude_only).toBe(30);
  });
  it("takes everything when a system has fewer than 10 positives", () => {
    const a = allocate({ both: 2, rules_only: 100, claude_only: 3 });
    expect(a.both + a.claude_only).toBe(5);
  });
  it("draws the same items for the same seed, regardless of input order", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ key: `p${i}`, stratum: stratumOf(i % 2 === 0, i % 3 === 0)! })).filter((x) => x.stratum);
    const alloc = { both: 3, rules_only: 4, claude_only: 2 };
    expect(drawSample(items, alloc, 7)).toEqual(drawSample([...items].reverse(), alloc, 7));
  });
  it("builds per-system strata from verdicts", () => {
    const s = systemStrata({ both: 10, rules_only: 5, claude_only: 5 }, [{ stratum: "both", verdict: "verified" }, { stratum: "claude_only", verdict: "refuted" }], "claude");
    expect(s).toEqual([
      { population: 10, verified: 1, refuted: 0, unverifiable: 0 },
      { population: 5, verified: 0, refuted: 1, unverifiable: 0 },
    ]);
  });
});
