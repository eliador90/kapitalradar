import { describe, expect, it } from "vitest";
import { isRoundNews, matchConfirmations, nameStem, normalizeName, stageOf, statedAmountOf, type CompanyForMatch, type FinancingArticle } from "./confirmations";

const soverli: CompanyForMatch = { uid: "CHE453478419", names: ["Soverli AG"], increases: [{ publicationId: "p1", publishedAt: "2025-09-24" }] };
const sika: CompanyForMatch = { uid: "CHE000000001", names: ["Sika AG"], increases: [{ publicationId: "s1", publishedAt: "2025-11-01" }] };
const article = (over: Partial<FinancingArticle> = {}): FinancingArticle => ({
  url: "https://www.startupticker.ch/en/news/soverli-raises",
  date: "2025-12-16",
  title: "Soverli raises CHF 3.5 million in a seed round",
  companies: ["Soverli AG", "Sika AG"],
  ...over,
});

describe("confirmation matching", () => {
  it("normalizes legal names and stems", () => {
    expect(normalizeName("Électron Sàrl")).toBe("electron sarl");
    expect(nameStem("Soverli AG")).toBe("soverli");
    expect(nameStem("L.E.S.S. SA")).toBe("l.e.s.s.");
  });

  it.each([
    ["Soverli raises CHF 3.5 million seed round", true],
    ["Fusionality raises CHF 3 million to take fusion devices next level", true],
    ["siabit übernimmt Mitbewerber-Software und gewinnt neuen Investor", true],
    ["Une levée de fonds de CHF 2 millions pour Soverli", true],
    ["Ipsen to acquire Memo Therapeutics for up to EUR 700 million", false],
    ["TargImmune Therapeutics gets acquired", false],
    ["BOXS übernimmt Recoplast", false],
    ["DEKRA wird Mehrheitseigner des Zürcher Insurtechs Spearhead", false],
    ["Axmed secures $6 million grant from the Gates Foundation", false],
    ["Wellcome awards CHF 14 million for BioVersys' BV100 Phase 2b study", false],
    ["Un prêt de € 1M pour porter les projets d'Insolight en France", false],
    ["Terra Quantum AG to go public at Nasdaq in $3.25 billion SPAC deal", false],
  ])("treats %j as round news: %s", (title, expected) => {
    expect(isRoundNews(title)).toBe(expected);
  });

  it("never confirms from news that is not a round", () => {
    expect(matchConfirmations([article({ title: "Soverli secures CHF 3.5 million grant" })], [soverli])).toEqual([]);
  });

  it("confirms the raiser named in the title, not the linked investor", () => {
    const rows = matchConfirmations([article()], [soverli, sika]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyUid: "CHE453478419", eventMatch: "accepted", matchConfidence: "high", matchedPublicationId: "p1", statedAmount: "3500000", statedCurrency: "CHF", stage: "seed" });
  });

  it("is a possible confirmation when several increases fall in the window", () => {
    const two = { ...soverli, increases: [...soverli.increases, { publicationId: "p2", publishedAt: "2026-03-20" }] };
    const [row] = matchConfirmations([article()], [two]);
    expect(row).toMatchObject({ eventMatch: "uncertain", matchConfidence: "low", matchedPublicationId: "p1" });
  });

  it("skips articles that don't link one of our companies, or whose title names nobody we track", () => {
    expect(matchConfirmations([article({ companies: ["Other AG"] })], [soverli])).toEqual([]);
    expect(matchConfirmations([article({ title: "Investors back a Zurich deep-tech startup" })], [soverli])).toEqual([]);
  });

  it("records an announcement without an increase in the window as unmatched", () => {
    const [row] = matchConfirmations([article({ date: "2026-09-30" })], [soverli]);
    expect(row).toMatchObject({ eventMatch: "uncertain", matchConfidence: "low", matchedPublicationId: null });
  });

  it("reads stated amounts and stages from titles", () => {
    expect(statedAmountOf("ExerGo secures USD 4 million")).toEqual({ amount: "4000000", currency: "USD" });
    expect(statedAmountOf("Aeler closes 10.4 million francs Series A")).toEqual({ amount: "10400000", currency: "CHF" });
    expect(statedAmountOf("New partnership announced")).toBeNull();
    expect(stageOf("Kandou raises a $225m Series A")).toBe("series a");
  });
});
