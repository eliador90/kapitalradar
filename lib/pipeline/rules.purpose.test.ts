// Purpose patterns: the T5/T6 review's false positives stay false.
import { describe, expect, it } from "vitest";
import { firstSentence, HOLDING_PURPOSE, TECH_PURPOSE } from "./rules";

describe("TECH_PURPOSE", () => {
  it.each([
    "Übernahme von Mandaten im Treuhandbereich",
    "Verkauf von Parzellen und Bauland",
    "Erteilung von Informationen an Kunden",
    "Gebäudetechnik und Sanitärinstallationen",
    "Entwicklung von Immobilienprojekten",
    "développement de projets immobiliers",
    "assunzione di mandati fiduciari",
    "Betrieb einer Praxis für Physiotherapie",
    "Leistungen in Anspruch genommen werden",
  ])("does not fire on %j", (s) => expect(TECH_PURPOSE.test(s)).toBe(false));

  it.each([
    "Entwicklung und Vertrieb von Software",
    "conception et commercialisation de logiciels et solutions numériques",
    "Entwicklung von KI-Lösungen für Unternehmen",
    "Forschung, Entwicklung und Vertrieb von pharmazeutischen Produkten",
    "développement de dispositifs médicaux et diagnostiques",
    "Entwicklung von Gassensoren",
    "sviluppo di soluzioni di intelligenza artificiale",
  ])("fires on %j", (s) => expect(TECH_PURPOSE.test(s)).toBe(true));
});

describe("HOLDING_PURPOSE on the opening sentence", () => {
  it("ignores the may-participate boilerplate", () => {
    const p = "Die Gesellschaft bezweckt den Betrieb einer Bäckerei. Sie kann Beteiligungen an anderen Unternehmen erwerben.";
    expect(HOLDING_PURPOSE.test(firstSentence(p))).toBe(false);
    expect(HOLDING_PURPOSE.test(firstSentence("La société a pour but la prise de participations. Elle peut acquérir des immeubles."))).toBe(true);
    expect(HOLDING_PURPOSE.test(firstSentence("Die Gesellschaft bezweckt das Halten und die Verwaltung von Beteiligungen. Sie kann Grundstücke erwerben."))).toBe(true);
  });
});
