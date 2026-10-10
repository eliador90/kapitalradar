import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANTON_CODES, parseCanton, SWISS_MAP } from "./cantons";
import { ALL_SHARES, capitalSeries, compactAmount } from "./capital-series";
import { evalLine, missesSummary, parseReleaseEval, type ReleaseEval } from "./eval-result";
import { shareIssuance } from "./issuance";
import { deriveStatus, feedFilterOf, parseFeedFilters } from "./status";
import { uidFromPathSegment } from "./uid";

describe("shareIssuance", () => {
  it("is new shares over post-step shares", () => {
    expect(shareIssuance({ sharesBefore: 100_000, sharesAfter: 125_000, direction: "increase" })).toEqual({ kind: "figure", newShares: 25_000, fraction: 0.2 });
  });
  it.each([
    [{ sharesBefore: null, sharesAfter: 10 }, "share counts not published"],
    [{ sharesBefore: 10, sharesAfter: 20, nominalChanged: true }, "nominal value per share changed"],
    [{ sharesBefore: 10, sharesAfter: 20, restructuringPair: true }, "shares cancelled and reissued"],
    [{ sharesBefore: 20, sharesAfter: 10, direction: "reduction" as const }, "capital reduction"],
    [{ sharesBefore: 10, sharesAfter: 20, withConversion: true }, "conversion to an AG"],
    [{ sharesBefore: 10, sharesAfter: 10 }, "no new shares"],
  ])("gives no figure for %o", (input, reason) => {
    expect(shareIssuance(input)).toEqual({ kind: "none", reason });
  });
});

describe("feed filters", () => {
  it("defaults to likely financings and confirmed rounds", () => {
    expect(parseFeedFilters(undefined)).toEqual({ filters: ["likely", "confirmed"], isDefault: true });
    expect(parseFeedFilters(["bogus"])).toEqual({ filters: ["likely", "confirmed"], isDefault: true });
  });
  it("reads repeated and comma-separated values, and all", () => {
    expect(parseFeedFilters(["undecided", "likely"]).filters).toEqual(["likely", "undecided"]);
    expect(parseFeedFilters("likely,increased")).toEqual({ filters: ["likely", "increased"], isDefault: false });
    expect(parseFeedFilters("all").filters).toEqual(["likely", "confirmed", "undecided", "increased"]);
  });
  it("keeps a possible confirmation in its tier's group; an accepted match moves it to confirmed", () => {
    const possible = deriveStatus("capital_increased", [{ eventMatch: "uncertain", matchConfidence: "high", reviewedAt: null }]);
    expect(feedFilterOf(possible, "capital_increased")).toBe("increased");
    const confirmed = deriveStatus("capital_increased", [{ eventMatch: "accepted", matchConfidence: "high", reviewedAt: null }]);
    expect(feedFilterOf(confirmed, "capital_increased")).toBe("confirmed");
    expect(feedFilterOf(deriveStatus("abstain", []), "abstain")).toBe("undecided");
  });
});

describe("release eval", () => {
  const e: ReleaseEval = {
    evaluatedOn: "2026-10-08",
    provisional: false,
    cohortSize: 30,
    systems: {
      rulesPlusClaude: { precision: { lo: 0.62, hi: 0.91, estimateLo: 0.8, estimateHi: 0.8, n: 15 }, recall: { hits: 21, n: 30 } },
      rulesOnly: { precision: null, recall: { hits: 17, n: 30 } },
    },
    recallIncludingUndecided: null,
    misses: [],
    rejections: [],
    knownIssues: [],
  };
  it("renders the one-line summary with the does-not-rewind label", () => {
    expect(evalLine(e)).toBe(
      "Release evaluation · 8 Oct 2026 · does not rewind · rules + Claude: precision 62%–91% (n=15), recall 21/30 announced rounds · rules-only: precision not measured, recall 17/30 announced rounds",
    );
  });
  it("says 0 misses among N", () => expect(missesSummary(e)).toBe("0 misses among 30 evaluated rounds."));
  it("rejects a malformed artifact instead of rendering it", () => expect(parseReleaseEval({ cohortSize: 1 })).toBeNull());
});

describe("uidFromPathSegment", () => {
  it("normalizes and survives malformed percent-encoding", () => {
    expect(uidFromPathSegment("CHE-123.456.789")).toBe("CHE123456789");
    expect(uidFromPathSegment("%E0%A4%A")).toBeNull();
  });
});

// DT1: every text token pair on paper reaches WCAG AA (4.5:1).
describe("design tokens", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)![1]!;
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  it.each(["ink", "ink-muted", "time"])("--%s on --paper is at least 4.5:1", (name) => {
    expect(contrast(token(name), token("paper"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("capitalSeries", () => {
  const cls = (count: number, nominal: string, label: string | null, preferred = false) => ({ count, nominal, currency: "CHF" as const, label, preferred });
  const step = (publishedAt: string, before: string | null, after: string, extra: Partial<Parameters<typeof capitalSeries>[0][number]> = {}) => ({
    publishedAt, currency: "CHF", capitalBefore: before, capitalAfter: after, classesAfter: null, tone: "likely", ...extra,
  });

  it("splits a step by class when the classes add up, preferred classes on top", () => {
    const s = capitalSeries([step("2026-03-02", "100000", "125000", { classesAfter: [cls(25_000, "1", "Seed", true), cls(100_000, "1", null)] })])!;
    expect(s.keys).toEqual(["shares", "Seed"]);
    expect(s.steps[0]!.parts).toEqual([{ key: "Seed", value: 25_000 }, { key: "shares", value: 100_000 }]);
    expect(s.start).toBe(100_000);
  });
  it("falls back to one total when the classes don't match the stated capital", () => {
    const s = capitalSeries([step("2026-03-02", null, "125000", { classesAfter: [cls(10, "1", null)] })])!;
    expect(s.steps[0]!.parts).toEqual([{ key: ALL_SHARES, value: 125_000 }]);
    expect(s.start).toBeNull();
  });
  it("draws only the latest currency run and counts what it leaves out", () => {
    const s = capitalSeries([
      step("2025-01-01", "100", "200", { currency: "EUR" }),
      step("2025-06-01", "200", "300", { currency: "CHF", currencyBefore: "EUR" }),
      step("2025-09-01", "300", "400", { currency: "CHF" }),
    ])!;
    expect([s.currency, s.omitted, s.steps.map((x) => x.total), s.start]).toEqual(["CHF", 1, [300, 400], null]);
  });
  it("is null without a stated capital", () => {
    expect(capitalSeries([step("2026-01-01", null, "1", { currency: null })])).toBeNull();
  });
  it("labels axes compactly", () => {
    expect([850, 1500, 120_000, 1_250_000, 2e9].map(compactAmount)).toEqual(["850", "1.5k", "120k", "1.3M", "2B"]);
  });
});

describe("cantons", () => {
  it("has all 26 cantons with a shape and a label position", () => {
    expect(CANTON_CODES).toHaveLength(26);
    for (const c of CANTON_CODES) expect(SWISS_MAP.cantons[c]!.d.startsWith("M")).toBe(true);
  });
  it("accepts only known canton codes", () => {
    expect([parseCanton("zh"), parseCanton("XX"), parseCanton(["ZH"]), parseCanton(undefined)]).toEqual(["ZH", null, null, null]);
  });
});
