// Reads the capital change of one SHAB HR publication from its structured XML. The full T4
// parser (share classes, events) builds on this; scripts share it so set-off and band
// detection have one definition.
import { normalizeUid } from "../domain/uid";
import { LEGAL_FORM, textAt } from "./xml";

// Set-off of creditor claims only: "Verrechnung mit dem Bilanzverlust" or "compensation de
// pertes" offset losses and are not contributions.
export const SET_OFF =
  /Verrechnung (?:einer |von |der )?Forderung|Forderung(?:en)?[\s\S]{0,160}?verrechnet|durch Verrechnung(?! mit)|compensation (?:de |d['’]une |des )créances?|compensazione (?:di |del |dei )credit/i;
export const CAPITAL_BAND = /Kapitalband|marge de fluctuation|margine di variazione/i;

export interface CapitalReading {
  /** Canonical UID of the publication's company, or null when the XML carries none. */
  uid: string | null;
  company: string;
  seat: string;
  isAg: boolean;
  before: number;
  after: number;
  isIncrease: boolean;
  text: string;
  purpose: string;
  setOff: boolean;
  capitalBand: boolean;
}

export function readCapital(xml: string): CapitalReading {
  const after = Number(textAt(xml, ["commonsNew", "capital", "nominal"]));
  const before = Number(textAt(xml, ["commonsActual", "capital", "nominal"]));
  const text = textAt(xml, ["content", "publicationText"]) ?? "";
  return {
    uid: normalizeUid(textAt(xml, ["commonsNew", "company", "uid"]) ?? ""),
    company: textAt(xml, ["commonsNew", "company", "name"]) ?? "",
    seat: textAt(xml, ["commonsNew", "company", "seat"]) ?? "",
    isAg: textAt(xml, ["commonsNew", "company", "legalForm"]) === LEGAL_FORM.AG,
    before,
    after,
    isIncrease: Number.isFinite(before) && Number.isFinite(after) && after > before,
    text,
    purpose: textAt(xml, ["commonsNew", "purpose"]) ?? "",
    setOff: SET_OFF.test(text),
    capitalBand: CAPITAL_BAND.test(text),
  };
}
