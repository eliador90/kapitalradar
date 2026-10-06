// A compact view of one publication's capital change for the eval scripts (sampling, spike,
// X1, fixtures). Built on the parser, so capital, set-off and band are read in one place.
import { LEGAL_FORM } from "./xml";
import { activeText, CAPITAL_BAND, parsePublication, SET_OFF } from "./parse";

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
  /** The increase is paid at least partly by setting off claims. */
  setOff: boolean;
  capitalBand: boolean;
}

export function readCapital(xml: string): CapitalReading {
  const p = parsePublication(xml);
  const change = p.events.find((e) => e.type === "capital_change");
  const before = Number(p.capitalBefore);
  const after = Number(p.capitalAfter);
  return {
    uid: p.companyUid,
    company: p.companyName,
    seat: p.seat,
    isAg: p.legalForm === LEGAL_FORM.AG,
    before,
    after,
    isIncrease: p.capitalBefore !== null && p.capitalAfter !== null && after > before,
    text: p.text,
    purpose: p.purpose,
    // The parser's own set-off definition, on the entry's active text.
    setOff: change?.type === "capital_change" && SET_OFF.test(activeText(p.text)),
    capitalBand: CAPITAL_BAND.test(p.text),
  };
}
