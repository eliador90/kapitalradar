import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RULES } from "../domain/rule-catalog";
import type { ParsedEvent } from "../domain/events";
import type { CapitalContext } from "./fold";
import { parsePublication } from "./parse";
import { defaultRuleConfig, evaluateRules, fitThreshold } from "./rules";

type Capital = Extract<ParsedEvent, { type: "capital_change" }>;
const AG = "0106";
const ctx = (over: Partial<CapitalContext> = {}): CapitalContext => ({
  publicationNumber: "HR02-1",
  sharesBefore: null,
  sharesBeforeSource: "unknown",
  newPreferredClass: null,
  foundedOn: null,
  ageBucket: "unknown",
  priorCapitalBand: false,
  convertedBefore: false,
  ...over,
});
const fromFixture = (slug: string) => {
  const p = parsePublication(readFileSync(`eval/fixtures/shab/${slug}.xml`, "utf8"));
  const e = p.events.find((x) => x.type === "capital_change") as Capital;
  return { p, e, ctx: ctx({ sharesBefore: e.sharesBefore, newPreferredClass: e.payload.newPreferredClass }) };
};
const run = (slug: string, over: Partial<CapitalContext> = {}) => {
  const { p, e, ctx: c } = fromFixture(slug);
  return evaluateRules({ event: e, context: { ...c, ...over }, purpose: p.purpose, legalForm: p.legalForm });
};

describe("rules on fixtures", () => {
  it.each([
    // slug, expected hits (order-insensitive), candidate
    // the gazette spells "Kl-Lösungen" (lowercase L), so no tech wording is matched
    ["de-new-preferred-preseed", ["odd_amount_small_nominal", "new_preferred_class"], true],
    // +1.1% of shares, existing classes only: ESOP-sized as well as set-off
    ["de-set-off-within-band", ["odd_amount_small_nominal", "tech_purpose", "set_off_only", "esop_sized_increment"], true],
    // holding company, +CHF 20'000 in kind
    ["de-in-kind", ["in_kind_only", "round_amount_holding"], true],
    ["de-deleted-in-kind-is-cash", ["odd_amount_small_nominal", "esop_sized_increment"], true],
    // crowdinvesting platform ("plateforme") counts as a tech purpose
    ["fr-conditional-capital", ["odd_amount_small_nominal", "esop_sized_increment", "conditional_capital_issuance", "tech_purpose"], true],
    ["de-restructuring-pair", ["restructuring_pair"], false],
    ["fr-reduction", ["capital_reduction", "new_preferred_class"], false],
  ] as const)("%s", (slug, hits, candidate) => {
    const r = run(slug);
    expect([...r.hits].sort()).toEqual([...hits].sort());
    expect(r.candidate).toBe(candidate);
  });

  it("rejects non-AG and reductions with a reason, and still scores them (eng Q2)", () => {
    const { p, e, ctx: c } = fromFixture("de-in-kind");
    expect(evaluateRules({ event: e, context: c, purpose: p.purpose, legalForm: "0107" }).rejectReason).toBe("not_ag");
    expect(run("fr-reduction").rejectReason).toBe("capital_reduction");
    expect(run("de-restructuring-pair").rejectReason).toBe("restructuring_pair");
    expect(run("fr-reduction").rulesPositive).toBe(false);
  });

  it("fires the age rule only with a known founding date under six years (eng Q4)", () => {
    expect(run("de-in-kind", { ageBucket: "unknown" }).hits).not.toContain("young_company");
    expect(run("de-in-kind", { ageBucket: "2_to_6" }).hits).toContain("young_company");
    expect(run("de-in-kind", { ageBucket: "6_plus" }).hits).not.toContain("young_company");
  });

  it("does not call a small increment ESOP-sized when it creates a preferred class", () => {
    const { p, e } = fromFixture("de-set-off-within-band"); // +1.1% of shares
    const base = { event: e, purpose: p.purpose, legalForm: AG };
    expect(evaluateRules({ ...base, context: ctx({ sharesBefore: e.sharesBefore, newPreferredClass: false }) }).hits).toContain("esop_sized_increment");
    expect(evaluateRules({ ...base, context: ctx({ sharesBefore: e.sharesBefore, newPreferredClass: true }) }).hits).not.toContain("esop_sized_increment");
  });

  it("scores with the catalog weights", () => {
    const r = run("de-new-preferred-preseed");
    const w = Object.fromEntries(RULES.map((x) => [x.id, x.weight]));
    expect(r.score).toBeCloseTo(w.odd_amount_small_nominal! + w.new_preferred_class!);
    expect(evaluateRules({ ...fromFixture("de-new-preferred-preseed"), event: fromFixture("de-new-preferred-preseed").e, context: fromFixture("de-new-preferred-preseed").ctx, purpose: "x", legalForm: AG }, defaultRuleConfig(99)).rulesPositive).toBe(false);
  });
});

describe("fitThreshold", () => {
  it("maximizes F1 and breaks ties towards the higher threshold", () => {
    const items = [
      { score: 3, positive: true, candidate: true },
      { score: 2, positive: true, candidate: true },
      { score: 2, positive: false, candidate: true },
      { score: 0, positive: false, candidate: true },
      { score: 5, positive: false, candidate: false }, // rejects never count as predicted
    ];
    const best = fitThreshold(items);
    expect(best).toMatchObject({ threshold: 2, tp: 2, fp: 1, fn: 0 });
  });
});
