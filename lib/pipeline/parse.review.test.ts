// Regression tests for the T4 review findings (H1–H4, M6–M11).
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { companyLevelText, maskInlinePersons, personDataHits } from "./clauses";
import { contributionOf, parsePublication } from "./parse";

const wrap = (text: string) =>
  `<HR02:publication><meta><id>x</id><rubric>HR</rubric><subRubric>HR02</subRubric><language>fr</language>` +
  `<publicationNumber>HR02-1</publicationNumber><publicationDate>2026-09-01</publicationDate></meta><content>` +
  `<journalDate>2026-08-28</journalDate><publicationText>${text}</publicationText>` +
  `<commonsNew><company><name>Acme SA</name><uid>CHE-123.456.789</uid><legalForm>0106</legalForm></company><capital><nominal>450000.00</nominal></capital></commonsNew>` +
  `<commonsActual><company><name>Acme SA</name><uid>CHE-123.456.789</uid><legalForm>0106</legalForm></company><capital><nominal>320000.00</nominal></capital></commonsActual>` +
  `</content></HR02:publication>`;

const cc = (text: string) => {
  const e = parsePublication(wrap(text)).events.find((x) => x.type === "capital_change");
  if (!e || e.type !== "capital_change") throw new Error("no capital_change");
  return e;
};

describe("T4 review regressions", () => {
  it("H1: adopting conditional capital alongside a cash round stays cash", () => {
    const fr =
      "Augmentation ordinaire du capital-actions. Nouveau capital-actions entièrement libéré: CHF 450'000, divisé en 450 actions nominatives de CHF 1'000. " +
      "L'assemblée générale a introduit une clause statutaire relative à une augmentation conditionnelle du capital par décision du 31.08.2026.";
    expect(cc(fr).contributionType).toBe("cash");
    expect(contributionOf("Ordentliche Kapitalerhöhung. Die Generalversammlung hat eine bedingte Kapitalerhöhung gemäss näherer Umschreibung in den Statuten beschlossen.")).toBe("cash");
    expect(contributionOf("Kapitalerhöhung aus bedingtem Aktienkapital.")).toBe("conditional_capital");
  });

  it("H2: a contribution clause naming a person still counts", () => {
    expect(contributionOf("Sacheinlage: Die Gesellschaft übernimmt von Muster, Hans, von Bern, in Zug, 100 Aktien der Y AG.")).toBe("in_kind");
  });

  it("H3: set-off amount followed by a comma", () => {
    const text =
      "Augmentation ordinaire du capital-actions par compensation d'une créance de CHF 20'000.00, en contrepartie, il est remis 130 actions de CHF 1'000. " +
      "Nouveau capital-actions: CHF 450'000, divisé en 450 actions nominatives de CHF 1'000.";
    expect(cc(text).payload.setOffAmount).toBe("20000.00");
  });

  it("M6: issued shares are summed over classes", () => {
    const e = cc(
      "Augmentation ordinaire du capital-actions porté de CHF 320'000 à CHF 450'000 par l'émission de 100 actions nominatives de CHF 1'000 et 30 actions nominatives de CHF 1'000, privilégiées. " +
        "Capital-actions: CHF 450'000, divisé en 450 actions nominatives de CHF 1'000.",
    );
    expect([e.payload.sharesIssued, e.sharesBefore]).toEqual([130, 320]);
  });

  it("M7: 'dont N actions privilégiées' is not a partial set-off", () => {
    const text = "par l'émission de 1'000 actions de CHF 1, dont 400 actions privilégiées, toutes libérées par compensation de créances de CHF 1'000.";
    expect(contributionOf(text, 1000)).toBe("set_off");
  });

  it("M8: removal notices are not contributions", () => {
    expect(contributionOf("Augmentation ordinaire du capital-actions. Radiation de la disposition statutaire relative à une reprise de biens envisagée.")).toBe("cash");
    expect(contributionOf("Augmentation ordinaire. Suppression de la disposition statutaire du 12.03.2019 relative à l'apport en nature.")).toBe("cash");
  });

  it("M9: loss compensation is not a set-off", () => {
    expect(contributionOf("Ordentliche Kapitalerhöhung. Verrechnung mit dem Bilanzverlust.")).toBe("cash");
  });

  it("M10: the legal date comes from the statutes clause, with 1er and validation", () => {
    expect(parsePublication(wrap("Acme SA, à Nyon, CHE-123.456.789. Capital selon statuts du 12.03.2019 inchangé. Statuts modifiés le 31.08.2026.")).legalDate).toBe("2026-08-31");
    expect(parsePublication(wrap("Acme SA, à Nyon, CHE-123.456.789. Statuts modifiés le 1er juin 2026.")).legalDate).toBe("2026-06-01");
    const bad = parsePublication(wrap("Acme SA, à Nyon, CHE-123.456.789. Statuts modifiés le 31.02.2026."));
    expect(bad.legalDate).toBe("2026-08-28");
    expect(bad.warnings).toContain("statutes clause without a readable date");
  });

  it("M11: cancellations cite numbers across dates", () => {
    const p = parsePublication(wrap("Annullierung der im SHAB vom 20.03.2026 unter Meldungsnummer 1006601905 publizierten Eintragung."));
    expect(p.events).toContainEqual({ type: "cancellation", payload: { cancelsPublicationNumber: "HR02-1006601905" } });
  });

  it("H4: masking covers more phrasings and the person clauses split correctly", () => {
    expect(maskInlinePersons("souscrites par l'associé unique Jean Exemple")).toBe("souscrites par l'associé unique <PERSON_1>");
    expect(maskInlinePersons("contre attribution à Jean Exemple de 100 actions")).toBe("contre attribution à <PERSON_1> de 100 actions");
    expect(companyLevelText("Zweck neu: Betrieb einer Praxis an der Y AG. Eingetragene Personen neu oder mutierend: Muster, Anna, von Bern, in Zug, Mitglied.")).toBe(
      "Zweck neu: Betrieb einer Praxis an der Y AG.",
    );
    expect(companyLevelText("Aktienkapital neu: CHF 1.00. von Muralt, Hans, von Bern, in Zug, Präsident.")).toBe("Aktienkapital neu: CHF 1.00.");
  });

  it("H4: the person-data gate", () => {
    expect(personDataHits("Gesellschafter Anna Muster zeichnet")).toEqual(["role followed by a name"]);
    expect(personDataHits("Muster, Anna, von Bern, in Zug")).toContain("register person format");
    expect(personDataHits("souscrites par l'associé <PERSON_1>.")).toEqual([]);
  });

  it("H4: every committed fixture passes the person-data gate", () => {
    for (const f of readdirSync("eval/fixtures/shab")) expect(personDataHits(readFileSync(`eval/fixtures/shab/${f}`, "utf8")), f).toEqual([]);
  });
});
