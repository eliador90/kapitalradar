import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ParsedEvent } from "../domain/events";
import { companyLevelText, maskInlinePersons } from "./clauses";
import { contributionOf, parsePublication, parseSwissDate } from "./parse";

const fixture = (slug: string) => parsePublication(readFileSync(`eval/fixtures/shab/${slug}.xml`, "utf8"));
const capital = (slug: string) => {
  const e = fixture(slug).events.find((x) => x.type === "capital_change");
  if (!e || e.type !== "capital_change") throw new Error(`${slug}: no capital_change`);
  return e;
};
const types = (slug: string) => fixture(slug).events.map((e: ParsedEvent) => e.type);

describe("parse: capital changes (expectations checked by hand against each fixture text)", () => {
  it.each([
    // slug, contribution, before → after nominal, shares before → after, new preferred class
    ["de-in-kind", "in_kind", "100000.00", "120000.00", 100, 120, false],
    ["de-new-preferred-preseed", "cash", "100000.00", "138717.94", 10_000_000, 13_871_794, true],
    ["de-set-off-within-band", "set_off", "406369.10", "410780.70", 4_063_691, 4_107_807, false],
    ["de-deleted-in-kind-is-cash", "cash", "507015.89", "512339.75", 50_701_589, 51_233_975, false],
    ["de-new-seed-class-mixed", "mixed", "100000.00", "170151.13", 10_000_000, 17_015_113, true],
    ["fr-new-format-cash", "cash", "320000.00", "450000.00", null, 450, null],
    ["fr-set-off", "set_off", "200000.00", "200100.00", null, 2001, null],
    ["fr-conditional-capital", "conditional_capital", "179567.84", "179778.59", 17_956_784, 17_977_859, null],
    ["fr-mixed-partial-set-off", "mixed", "46878211.00", "92689019.00", 46_878_211, 92_689_019, null],
    ["fr-old-format-mixed", "mixed", "108737.80", "558537.32", 10_873_780, 55_853_732, null],
    ["it-increase", "cash", "1374762.00", "1446965.00", 1_374_762, 1_446_965, false],
  ] as const)("%s", (slug, contribution, before, after, sharesBefore, sharesAfter, newPreferred) => {
    const e = capital(slug);
    expect(e.payload.direction).toBe("increase");
    expect(e.contributionType).toBe(contribution);
    expect([e.capitalBefore, e.capitalAfter]).toEqual([before, after]);
    expect([e.sharesBefore, e.sharesAfter]).toEqual([sharesBefore, sharesAfter]);
    expect(e.payload.newPreferredClass).toBe(newPreferred);
    expect(e.payload.restructuringPair).toBe(false);
  });

  it("reads set-off amounts and currencies", () => {
    expect([capital("de-set-off-within-band").payload.setOffAmount, capital("de-set-off-within-band").payload.setOffCurrency]).toEqual(["137862.50", "CHF"]);
    expect(capital("fr-set-off").payload.setOffAmount).toBe("8606525.59");
    expect(capital("de-conversion-name-change").payload.setOffAmount).toBe("100000.00");
    expect(capital("fr-usd").currency).toBe("USD");
  });

  it("parses share classes with preferred labels", () => {
    expect(capital("de-set-off-within-band").payload.classesAfter).toEqual([
      { count: 1_020_000, nominal: "0.1", currency: "CHF", label: null, preferred: false },
      { count: 1_029_410, nominal: "0.1", currency: "CHF", label: "Vorzugsaktien Serie S", preferred: true },
      { count: 2_058_397, nominal: "0.1", currency: "CHF", label: "Vorzugsaktien Serie A", preferred: true },
    ]);
    expect(capital("fr-old-format-mixed").payload.classesAfter?.map((c) => c.preferred)).toEqual([false, true]);
    expect(capital("de-set-off-within-band").payload.withinCapitalBand).toBe(true);
  });

  it("flags the accordion restructuring pair (hard negative) only", () => {
    const ehco = capital("de-restructuring-pair"); // reduction to cover losses + re-increase
    expect(ehco.payload).toMatchObject({ direction: "unchanged", restructuringPair: true, nominalChanged: true, setOffAmount: "310000.00" });
    expect([ehco.sharesBefore, ehco.sharesAfter]).toEqual([1_692_898, 3_385_796]);
    // Treasury shares destroyed, then a preferred round: a financing, not a pair.
    const recap = capital("fr-split-new-preferred");
    expect(recap.payload).toMatchObject({ direction: "increase", restructuringPair: false, newPreferredClass: true, nominalChanged: true });
    expect(recap.contributionType).toBe("mixed");
    expect([recap.sharesBefore, recap.sharesAfter]).toEqual([6_580, 20_738_961]);
  });

  it("takes the last share statement of a multi-step entry and sums issued classes", () => {
    const e = capital("fr-reduction");
    expect(e.payload).toMatchObject({ direction: "reduction", restructuringPair: false, sharesIssued: 12_451_345 });
    expect([e.sharesBefore, e.sharesAfter]).toEqual([268_984, 12_720_329]);
    expect(e.contributionType).toBe("unknown");
  });
});

describe("parse v3: cases found through the v1 precision sample (decision log #37)", () => {
  it("reads 'Forderungen … zur Verrechnung gebracht' covering every new share as set-off only", () => {
    const e = capital("de-set-off-zur-verrechnung");
    expect(e.contributionType).toBe("set_off");
    expect(e.payload.direction).toBe("increase");
  });
  it("treats a redenomination that re-splits shares to keep the nominal as no increase", () => {
    const e = capital("de-redenomination-resplit");
    expect(e.payload.currencyBefore).toBe("CHF");
    expect(e.currency).toBe("USD");
    expect(e.payload.direction).toBe("unchanged");
  });
  it("treats the old French 'la monnaie du capital-actions … a été convertie' as no increase", () => {
    const p = fixture("fr-redenomination");
    const e = p.events.find((x) => x.type === "capital_change");
    expect(e?.type === "capital_change" ? e.payload.direction : "no capital event").not.toBe("increase");
  });
  // The review's inputs (2026-10-07): extra clauses spliced into the redenomination fixture.
  const withClause = (clause: string) =>
    parsePublication(readFileSync("eval/fixtures/shab/de-redenomination-resplit.xml", "utf8").replace("</publicationText>", ` ${clause}</publicationText>`));
  const direction = (p: ReturnType<typeof parsePublication>) => {
    const e = p.events.find((x) => x.type === "capital_change");
    return e?.type === "capital_change" ? e.payload.direction : "none";
  };
  it("does not read a statute-only clause about conditional capital as an issuance", () => {
    expect(direction(withClause("Die Gesellschaft hat mit Beschluss vom 25.03.2026 die Bestimmung betreffend Kapitalerhöhung aus bedingtem Aktienkapital geändert."))).not.toBe("increase");
  });
  it("reads 'Bei der Kapitalerhöhung vom … wofür N Aktien' across a currency change as an increase", () => {
    expect(
      direction(withClause("Qualifizierte Tatbestände neu: Verrechnung: Bei der Kapitalerhöhung vom 25.03.2026 werden Forderungen in der Höhe von USD 10'000.00 zur Verrechnung gebracht, wofür 1'000'000 Namenaktien zu USD 0.01 ausgegeben werden.")),
    ).toBe("increase");
  });
  it("does not read a loss offset as a set-off contribution", () => {
    expect(contributionOf("Ordentliche Kapitalerhöhung. Die Forderungen der Gläubiger sind trotz der Herabsetzung voll gedeckt. Der Herabsetzungsbetrag wird zur Verrechnung mit dem Bilanzverlust verwendet.")).toBe("cash");
    expect(contributionOf("Ordentliche Kapitalerhöhung. Forderungsverzicht der Aktionäre zur Verrechnung mit Verlusten.")).toBe("cash");
  });
  it("keeps a stated increase across a currency change, flagged so amounts aren't compared", () => {
    const e = capital("de-redenomination-with-increase");
    expect(e.payload.direction).toBe("increase");
    expect(e.payload.currencyBefore).toBe("CHF");
  });
});

describe("parse: other events", () => {
  it("emits conversions with their capital change", () => {
    expect(types("de-conversion-gmbh-ag")).toEqual(["conversion_to_ag", "capital_change", "name_change"]);
    expect(capital("de-conversion-gmbh-ag").payload.withConversion).toBe(true);
    expect(types("fr-conversion-sarl-sa")).toEqual(["conversion_to_ag", "capital_change", "name_change"]);
    expect(capital("fr-conversion-sarl-sa").contributionType).toBe("cash");
  });

  it("emits formations from HR01 with the statute date", () => {
    const p = fixture("fr-formation");
    expect(p.events).toEqual([{ type: "formation", payload: expect.objectContaining({ foundedOn: "2019-12-17" }) }]);
    expect(p.legalDate).toBe("2019-12-17");
  });

  it("records capital-band adoption and name changes", () => {
    expect(types("de-deleted-in-kind-is-cash")).toContain("capital_band");
    const p = fixture("de-conversion-name-change");
    expect(p.events.find((e) => e.type === "name_change")?.payload).toEqual({ from: "OPTIML GmbH", to: "OPTIML AG" });
  });

  it("links corrections to the corrected publication, DE and FR", () => {
    expect(fixture("de-correction").correctsPublicationNumber).toBe("HR02-1006601905");
    expect(fixture("fr-correction").correctsPublicationNumber).toBe("HR02-1005197281");
    expect(fixture("de-correction").events).toEqual([]);
  });

  it("parses every fixture without warnings and with a legal date on or before publication", () => {
    for (const slug of readdirSync("eval/fixtures/shab").map((f) => f.replace(/\.xml$/, ""))) {
      const p = fixture(slug);
      expect(p.warnings, slug).toEqual([]);
      expect(p.legalDate <= p.publishedAt, slug).toBe(true);
    }
  });
});

describe("contribution type", () => {
  it.each([
    ["Ordentliche Kapitalerhöhung.", "cash"],
    ["Qualifizierte Tatbestände neu: Sacheinlage: Die Gesellschaft übernimmt Vermögenswerte.", "in_kind"],
    ["Bei der Kapitalerhöhung werden Forderungen von CHF 1'000.50 verrechnet, wofür 10 Namenaktien zu CHF 1.00 ausgegeben werden.", "set_off"],
    ["Augmentation ordinaire du capital-actions en espèces et par compensation de créances de CHF 5'000.", "mixed"],
    ["[gestrichen: Sacheinlage: Die Gesellschaft übernimmt Aktien.] Ordentliche Erhöhung.", "cash"],
    ["Nachträgliche Vollliberierung durch Verrechnung einer Forderung von USD 65'000.00. Ordentliche Kapitalerhöhung.", "cash"],
    ["Kapitalerhöhung aus bedingtem Aktienkapital.", "conditional_capital"],
  ] as const)("%s → %s", (text, expected) => {
    expect(contributionOf(text, 10)).toBe(expected);
  });

  it("calls a set-off covering only part of the issued shares mixed", () => {
    const t = "dont 27'806'706 actions libérées par compensation de créances à hauteur de CHF 82'390'000.";
    expect(contributionOf(t, 45_810_808)).toBe("mixed");
    expect(contributionOf(t, 27_806_706)).toBe("set_off");
  });
});

describe("dates and clauses", () => {
  it("parses Swiss dates in three languages", () => {
    expect(parseSwissDate("Statutenänderung: 29.09.2026")).toBe("2026-09-29");
    expect(parseSwissDate("Statuts: 17 décembre 2019")).toBe("2019-12-17");
    expect(parseSwissDate("1er février 2024")).toBe("2024-02-01");
  });

  it("drops person clauses and masks inline names", () => {
    const text =
      "Acme AG, in Zug, CHE-123.456.789, Aktiengesellschaft (SHAB Nr. 1 vom 02.01.2026, Publ. 1000000001). " +
      "Aktienkapital neu: CHF 120'000.00 [bisher: CHF 100'000.00]. " +
      "Eingetragene Personen neu oder mutierend: Muster, Anna, von Bern, in Zug, Mitglied, mit Kollektivunterschrift zu zweien. " +
      "Beispiel Jean est maintenant à Genève.";
    expect(companyLevelText(text)).toBe(
      "Acme AG, in Zug, CHE-123.456.789, Aktiengesellschaft (SHAB Nr. 1 vom 02.01.2026, Publ. 1000000001). Aktienkapital neu: CHF 120'000.00 [bisher: CHF 100'000.00].",
    );
    expect(maskInlinePersons("80 parts souscrites par l'associé Jean Exemple.")).toBe("80 parts souscrites par l'associé <PERSON_1>.");
  });
});
