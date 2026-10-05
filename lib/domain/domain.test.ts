import { describe, expect, it } from "vitest";
import { asOfNoticeText, isVisibleAt, resolveAsOf } from "./asof";
import { addDays, isIsoDate, zurichDate } from "./dates";
import { formatAmount, formatCount, formatDate, formatDateRange, formatMoney } from "./format";
import { recall, weightedPrecision, wilson } from "./metrics";
import { RULES, claudeCatalog, getRule } from "./rule-catalog";
import { deriveStatus, type ConfirmationLink } from "./status";
import { formatUid, normalizeUid } from "./uid";
import { nextWeekAsOf, previousWeekAsOf, weekOf } from "./week";

const W = { backfillStart: "2025-08-01", snapshotDate: "2026-10-02" };

describe("uid", () => {
  it("normalizes and formats", () => {
    expect(normalizeUid(" che-123.456.789 ")).toBe("CHE123456789");
    expect(normalizeUid("CHE 123 456 789")).toBe("CHE123456789");
    expect(normalizeUid("CHE-123.456.78")).toBeNull();
    expect(normalizeUid("<script>")).toBeNull();
    expect(formatUid("CHE123456789")).toBe("CHE-123.456.789");
  });
});

describe("dates", () => {
  it("validates calendar dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-9-1")).toBe(false);
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // across the DST change
  });

  it("maps instants to the Zurich calendar day across DST", () => {
    // Sunday 23:30 in Zurich: summer (CEST, UTC+2) and winter (CET, UTC+1)
    expect(zurichDate(new Date("2026-10-04T21:30:00Z"))).toBe("2026-10-04");
    expect(zurichDate(new Date("2026-10-04T22:30:00Z"))).toBe("2026-10-05");
    expect(zurichDate(new Date("2026-11-01T22:30:00Z"))).toBe("2026-11-01");
    expect(zurichDate(new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-02");
  });
});

describe("asOf", () => {
  it("defaults to the snapshot", () => {
    expect(resolveAsOf(undefined, W)).toEqual({ asOf: "2026-10-02", isDefault: true, notice: null });
    expect(resolveAsOf("", W).isDefault).toBe(true);
  });

  it("clamps both ends with a notice", () => {
    expect(resolveAsOf("2027-01-01", W)).toEqual({ asOf: "2026-10-02", isDefault: false, notice: "clamped_latest" });
    expect(resolveAsOf("2024-01-01", W)).toEqual({ asOf: "2025-08-01", isDefault: false, notice: "clamped_earliest" });
    expect(asOfNoticeText("clamped_latest", "2026-09-29")).toBe("Showing 29 Sep 2026, the latest date in this release.");
  });

  it("treats malformed input as the default with a notice", () => {
    for (const bad of ["2026-13-01", "yesterday", "2026-02-30", "'; drop table--"]) {
      expect(resolveAsOf(bad, W)).toEqual({ asOf: "2026-10-02", isDefault: true, notice: "malformed" });
    }
    expect(resolveAsOf(["2026-01-05", "x"], W).asOf).toBe("2026-01-05");
  });

  it("makes a publication on the asOf day visible (inclusive)", () => {
    expect(isVisibleAt("2026-09-29", "2026-09-29")).toBe(true);
    expect(isVisibleAt("2026-09-30", "2026-09-29")).toBe(false);
  });
});

describe("week", () => {
  it("is Monday to Sunday, capped at asOf", () => {
    expect(weekOf("2026-09-23")).toEqual({ monday: "2026-09-21", sunday: "2026-09-27", start: "2026-09-21", end: "2026-09-23" });
    expect(weekOf("2026-09-27").end).toBe("2026-09-27"); // Sunday belongs to its own week
    expect(weekOf("2026-09-28").monday).toBe("2026-09-28"); // Monday starts the next one
  });

  it("handles the DST-change weeks", () => {
    expect(weekOf("2026-03-29")).toMatchObject({ monday: "2026-03-23", sunday: "2026-03-29" });
    expect(weekOf("2026-10-25")).toMatchObject({ monday: "2026-10-19", sunday: "2026-10-25" });
  });

  it("links to neighbouring weeks inside the release", () => {
    expect(previousWeekAsOf("2026-09-23", W.backfillStart)).toBe("2026-09-20");
    expect(previousWeekAsOf("2025-08-03", W.backfillStart)).toBeNull();
    expect(nextWeekAsOf("2026-09-16", W.snapshotDate)).toBe("2026-09-27");
    expect(nextWeekAsOf("2026-09-23", W.snapshotDate)).toBe("2026-10-02"); // capped at the snapshot
    expect(nextWeekAsOf("2026-09-30", W.snapshotDate)).toBe("2026-10-02"); // rest of the snapshot week
    expect(nextWeekAsOf("2026-10-02", W.snapshotDate)).toBeNull();
  });
});

describe("format", () => {
  it("uses Swiss amounts with cents dropped when zero", () => {
    expect(formatMoney("132231.38")).toBe("CHF 132’231.38");
    expect(formatMoney("100000.00")).toBe("CHF 100’000");
    expect(formatAmount("0.10")).toBe("0.10");
    expect(formatAmount("1234567.5")).toBe("1’234’567.50");
    expect(formatAmount(-1500)).toBe("-1’500");
    expect(() => formatAmount("1.234")).toThrow(/two decimals/);
    expect(formatCount(13282500)).toBe("13’282’500");
  });

  it("formats dates and ranges", () => {
    expect(formatDate("2026-03-03")).toBe("3 Mar 2026");
    expect(formatDateRange("2026-09-21", "2026-09-27")).toBe("21–27 Sep 2026");
    expect(formatDateRange("2026-09-28", "2026-10-04")).toBe("28 Sep – 4 Oct 2026");
    expect(formatDateRange("2025-12-29", "2026-01-04")).toBe("29 Dec 2025 – 4 Jan 2026");
    expect(formatDateRange("2026-09-21", "2026-09-21")).toBe("21 Sep 2026");
  });
});

describe("status (all 7 states)", () => {
  const link = (eventMatch: ConfirmationLink["eventMatch"], matchConfidence: ConfirmationLink["matchConfidence"], reviewedAt: string | null = null) => ({
    eventMatch,
    matchConfidence,
    reviewedAt,
  });

  it.each([
    ["capital_increased", [], "capital_increased", "○○○", "Capital increased"],
    ["abstain", [], "abstain", "◐○○", "Capital increased · undecided"],
    ["likely_financing", [], "likely_financing", "●●○", "Likely financing"],
    ["likely_financing", [link("accepted", "high")], "confirmed", "●●●", "Confirmed round"],
    ["capital_increased", [link("accepted", "high")], "confirmed_missed", "●●●", "Confirmed round · missed by classifier"],
    ["abstain", [link("accepted", "low", "2026-10-06T10:00:00Z")], "confirmed_missed", "●●●", "Confirmed round · missed by classifier"],
    ["likely_financing", [link("uncertain", "high")], "possible_confirmation", "●●○", "Likely financing · possible confirmation"],
    ["likely_financing", [link("accepted", "low")], "possible_confirmation", "●●○", "Likely financing · possible confirmation"],
    ["likely_financing", [link("rejected", "high")], "likely_financing", "●●○", "Likely financing"],
    [null, [], "not_assessed", "", "Not assessed"],
    [null, [link("accepted", "high")], "confirmed_missed", "●●●", "Confirmed round · missed by classifier"],
  ] as const)("tier %s + %j → %s", (tier, links, state, pips, label) => {
    expect(deriveStatus(tier, links)).toEqual({ state, pips, label });
  });
});

describe("rule catalog", () => {
  it("has unique ids with prompt lines and display sentences", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) {
      expect(r.claude.length).toBeGreaterThan(10);
      expect(r.display).toMatch(/\.$/);
    }
    expect(getRule("restructuring_pair")?.kind).toBe("hard_negative");
    expect(claudeCatalog().split("\n")).toHaveLength(RULES.length);
  });
});

describe("metrics", () => {
  it("matches published Wilson intervals", () => {
    const a = wilson(15, 20);
    expect(a.lo).toBeCloseTo(0.5313, 4);
    expect(a.hi).toBeCloseTo(0.8881, 4);
    expect(wilson(0, 10).lo).toBe(0); // boundary-safe
    expect(wilson(10, 10).hi).toBe(1);
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });

  it("weights precision by stratum population (hand-computed, X2)", () => {
    // Stratum A: 60 positives, sample 20 = 15 verified, 3 refuted, 2 unverifiable.
    // Stratum B: 40 positives, sample 10 = 6 verified, 4 refuted.
    // Weights 0.6 / 0.4. Low = 0.6·15/20 + 0.4·6/10 = 0.69. High = 0.6·17/20 + 0.4·6/10 = 0.75.
    // Interval low = 0.6·W(15,20).lo + 0.4·W(6,10).lo = 0.6·0.53131 + 0.4·0.31267 = 0.44385.
    // Interval high = 0.6·W(17,20).hi + 0.4·W(6,10).hi = 0.6·0.94759 + 0.4·0.83182 = 0.90128.
    const p = weightedPrecision([
      { population: 60, verified: 15, refuted: 3, unverifiable: 2 },
      { population: 40, verified: 6, refuted: 4, unverifiable: 0 },
    ]);
    expect(p.estimate.lo).toBeCloseTo(0.69, 10);
    expect(p.estimate.hi).toBeCloseTo(0.75, 10);
    expect(p.interval.lo).toBeCloseTo(0.44385, 4);
    expect(p.interval.hi).toBeCloseTo(0.90128, 4);
    expect(p.n).toBe(30);
  });

  it("ignores empty strata and rejects unsampled ones", () => {
    expect(weightedPrecision([{ population: 0, verified: 0, refuted: 0, unverifiable: 0 }, { population: 5, verified: 1, refuted: 0, unverifiable: 0 }]).estimate.lo).toBe(1);
    expect(() => weightedPrecision([{ population: 5, verified: 0, refuted: 0, unverifiable: 0 }])).toThrow();
  });

  it("computes recall with an interval", () => {
    expect(recall(24, 30)).toMatchObject({ detected: 24, cohort: 30, rate: 0.8 });
  });
});
