// Plan CI item "the feature-rule test": features for an event read only rows published on or
// before that event. Building with and without future rows injected must give identical output.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { assembleCompany } from "./candidates";
import { parsePublication, type ParsedPublication } from "./parse";

vi.mock("../../db/client", () => ({ db: () => { throw new Error("no DB in unit tests"); } }));

const fixture = (slug: string) => parsePublication(readFileSync(`eval/fixtures/shab/${slug}.xml`, "utf8"));

/** A later entry of the same company: renamed, a new preferred class, a formation-looking HR01. */
function future(base: ParsedPublication): ParsedPublication {
  const later = fixture("de-new-seed-class-mixed");
  return {
    ...later,
    id: "future-1",
    publicationNumber: "HR02-9999999999",
    publishedAt: "2027-01-15",
    legalDate: "2027-01-10",
    companyUid: base.companyUid,
    companyName: "Renamed Future AG",
    previousName: base.companyName,
    events: [...later.events, { type: "name_change", payload: { from: base.companyName, to: "Renamed Future AG" } }],
  };
}

describe("feature rule", () => {
  it.each(["de-new-preferred-preseed", "de-set-off-within-band", "fr-old-format-mixed", "de-conversion-name-change"])("future rows don't change %s", (slug) => {
    const base = fixture(slug);
    const without = assembleCompany(base.companyUid!, [base], null);
    const withFuture = assembleCompany(base.companyUid!, [base, future(base)], "2030-01-01");
    const pick = (b: typeof without) => b.capitalChanges.filter((c) => c.publication.id === base.id).map((c) => ({ hash: c.inputHash, rules: c.rules, context: c.context }));
    expect(pick(withFuture)).toEqual(pick(without));
  });
});
