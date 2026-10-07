// Deterministic SHAB HR parser (T4): one publication XML → company facts + typed events.
// Structured XML fields win (capital, legal form, name, purpose); the text supplies what the
// XML lacks (currency, share classes, contribution type, statute date, corrections).
import { addDays, isIsoDate } from "../domain/dates";
import { CURRENCIES, parsedEvent, preferredLabels, type ParsedEvent, type ShareClass } from "../domain/events";
import type { ContributionType } from "../domain/schemas";
import { normalizeUid } from "../domain/uid";
import { clausesOf, splitClauses, type Clause } from "./clauses";
import { LEGAL_FORM, section, textAt } from "./xml";

export const PARSER_VERSION = "3";

export interface ParsedPublication {
  id: string;
  publicationNumber: string;
  rubric: string;
  subRubric: string;
  language: string;
  publishedAt: string;
  journalDate: string | null;
  companyUid: string | null;
  companyName: string;
  previousName: string | null;
  legalForm: string | null;
  previousLegalForm: string | null;
  seat: string;
  /** Canton of the registering office (SHAB meta), e.g. "ZH". */
  canton: string | null;
  purpose: string;
  /** Statute-change date from the text, else the journal date, else the publication date. */
  legalDate: string;
  correctsPublicationNumber: string | null;
  /** Nominal capital before/after from the XML (decimal strings), whether or not it changed. */
  capitalBefore: string | null;
  capitalAfter: string | null;
  text: string;
  clauses: Clause[];
  events: ParsedEvent[];
  /** Non-fatal oddities, counted by the ingest run (never swallowed). */
  warnings: string[];
}

export class ParseError extends Error {}

// Set-off of creditor claims only: "Verrechnung mit dem Bilanzverlust" or "compensation de
// pertes" offset losses and are not contributions.
export const SET_OFF =
  /Verrechnung (?:einer |von |der )?Forderung|Forderung(?:en)?[\s\S]{0,160}?(?:verrechnet|zur Verrechnung)|durch Verrechnung(?! mit)|compensation (?:de |d['’]une |des )créances?|compensazione (?:di |del |dei )credit/i;
export const CAPITAL_BAND = /Kapitalband|marge de fluctuation|margine di variazione/i;

const CUR = `(${CURRENCIES.join("|")})`;
const num = (s: string) => s.replace(/[’'\s]/g, "").replace(/,(\d{1,2})$/, ".$1");
const decimal = (s: string | undefined) => (s === undefined || s.trim() === "" ? null : num(s.trim()));
/** "1000.00" → "1000", "0.10" → "0.1": one spelling per nominal across languages. */
const canonical = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);

/** The UID of a publication, readable even when the rest of the entry fails to parse. */
export const publicationUid = (xml: string) => normalizeUid(textAt(xml, ["commonsNew", "company", "uid"]) ?? "");

const MONTHS: Record<string, number> = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
  januar: 1, februar: 2, märz: 3, april: 4, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, dezember: 12,
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, dicembre: 12,
};

/** First date in `s` ("29.09.2026", "17 décembre 2019", "1er juin 2026") → ISO, else null. */
export function parseSwissDate(s: string): string | null {
  const d = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  const w = /(\d{1,2})(?:er)?\.? ([\p{L}]+) (\d{4})/u.exec(s);
  let iso: string | null = null;
  if (d && (!w || d.index <= w.index)) iso = `${d[3]}-${d[2]!.padStart(2, "0")}-${d[1]!.padStart(2, "0")}`;
  else if (w && MONTHS[w[2]!.toLowerCase()]) iso = `${w[3]}-${String(MONTHS[w[2]!.toLowerCase()]).padStart(2, "0")}-${w[1]!.padStart(2, "0")}`;
  return iso && isIsoDate(iso) ? iso : null;
}

// ---- active text ---------------------------------------------------------------------------

// Former text in brackets ("[bisher: …]", "[gestrichen: …]", "[non: …]") and notices that a
// clause or qualified fact was removed or that existing shares were paid up later describe
// other events. They are dropped before reading what this entry does.
const REMOVAL_NOTICE =
  /^(?:Suppression de la|Radiation de la|Streichung der|Soppressione della|Die Bestimmung über die (?:Sacheinlage|Sachübernahme)|Nachträgliche (?:Voll)?[Ll]iberierung|Le capital-actions a été libéré ultérieurement|libéré ultérieurement)/i;
const ADOPTION_NOTICE = /\b(beschlossen|eingeführt|geändert|aufgehoben|introduit une clause|modifié une clause|supprimé une clause|ha introdotto|ha modificato|ha soppresso)\b/i;

export function activeText(text: string): string {
  return splitClauses(text)
    .map((c) => c.text)
    .filter((t) => !REMOVAL_NOTICE.test(t))
    .join(" ")
    .replace(/\[[^\]]*\]/g, " ");
}

// ---- share classes -------------------------------------------------------------------------

const ITEM = {
  de: new RegExp(`(\\d[\\d’']*)\\s+((?:(?!\\d)[^,;\\[\\]])*?)\\s*zu\\s+${CUR}\\s+([\\d’'.]+)(?:\\s*\\(([^)]*)\\))?`, "g"),
  // The tail captures a label after the nominal ("série Seed") and the preference clause.
  fr: new RegExp(
    `(\\d[\\d’']*)\\s+((?:actions?|bons?)(?:(?!\\d)[^;\\[\\]])*?)\\s+de\\s+${CUR}\\s+([\\d’'.]*\\d)((?:\\s+(?:série|serie|catégorie|classe)\\s+[\\p{L}\\d-]+)?(?:,?\\s*privilégiées?[^,;\\]]*)?)`,
    "gu",
  ),
  it: new RegExp(`(\\d[\\d’']*)\\s+((?:azioni|buoni)(?:(?!\\d)[^;\\[\\]])*?)\\s+da\\s+${CUR}\\s+([\\d’'.]+)(?:\\s*\\(([^)]*)\\))?`, "g"),
};
const PREFERRED = /Vorzug|privilégi|privilegi|Serie|Série|Seed/i;
const NOT_SHARES = /Partizipationsschein|Genussschein|bons? de (participation|jouissance)|buoni di (partecipazione|godimento)/i;

export function parseShareItems(segment: string, lang: string): ShareClass[] {
  const re = ITEM[lang as keyof typeof ITEM] ?? ITEM.de;
  const out: ShareClass[] = [];
  for (const m of segment.matchAll(new RegExp(re.source, re.flags))) {
    const words = m[2]!.trim();
    if (NOT_SHARES.test(words)) continue;
    if (lang === "de" && !/aktien/i.test(words)) continue;
    const tail = (m[5] ?? "").trim().replace(/^,\s*/, "").replace(/\s+/g, " ");
    const descriptive = words
      .replace(/^(actions?|azioni)\s*/i, "")
      .replace(/\b(vinkulierte|Namenaktien|Inhaberaktien|Aktien|nominatives?|au porteur|nominative|ordinaires|ordinarie)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const label = [descriptive, tail].filter(Boolean).join(", ") || null;
    out.push({
      count: Number(num(m[1]!)),
      nominal: canonical(num(m[4]!).replace(/\.$/, "")),
      currency: m[3] as ShareClass["currency"],
      label,
      preferred: PREFERRED.test(`${words} ${tail}`),
    });
  }
  return out;
}

/**
 * The "after" and "before" share segments. One entry can state the share capital several times
 * (reduction, then increase): the last statement is the state after the entry, the first
 * explicit "before" (or the first of several statements) the state before.
 */
function shareSegments(text: string, lang: string): { after: string | null; before: string | null } {
  const patterns: Record<string, [RegExp, RegExp]> = {
    // Segments end at a sentence boundary (". " + capital letter), not at decimal points.
    de: [/Aktien neu:\s*([^[]*?)(?:\[bisher:\s*([^\]]*)\]|\.\s+(?=[A-ZÄÖÜ])|$)/, /Aktien:\s*([\s\S]*?)(?:\.\s+(?=[A-ZÄÖÜ])|\.?$)/],
    fr: [/Nouvelles actions:\s*([^[]*?)(?:\[précédemment:\s*([^\]]*)\]|\.\s+(?=[A-ZÉÈ])|$)/, /divisé en\s+([\s\S]*?)(?:\.\s+(?=[A-ZÉÈ])|\.?$)/],
    it: [/Nuove azioni:\s*([^[]*?)(?:\[finora:\s*([^\]]*)\]|\.\s+(?=[A-Z])|$)/, /suddiviso in\s+([\s\S]*?)(?:\.\s+(?=[A-Z])|\.?$)/],
  };
  const [primary, fallback] = patterns[lang] ?? patterns.de!;
  const statements: { at: number; after: string; before: string | null }[] = [];
  // French nominal split: "Les 6'580 actions … de CHF 100 sont transformées en …".
  const split = new RegExp(`Les\\s+(\\d[\\d’']*\\s+actions[^.]*?de\\s+${CUR}\\s+[\\d’'.]*\\d)\\s+sont transformées en\\s+([\\s\\S]*?)(?:\\.\\s+(?=[A-ZÉÈ])|\\.?$)`).exec(text);
  if (split) statements.push({ at: split.index, after: split[3]!, before: split[1]! });
  for (const re of [primary, fallback]) {
    for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))) {
      // Participation capital is stated the same way ("divisé en N bons de participation").
      if (/^\s*\d[\d’']*\s+(?:bons|Namen-Partizipationsscheine|Partizipationsscheine|buoni)/i.test(m[1]!)) continue;
      statements.push({ at: m.index!, after: m[1]!, before: re === primary ? (m[2] ?? null) : null });
    }
  }
  if (statements.length === 0) return { after: null, before: null };
  statements.sort((a, b) => a.at - b.at);
  const first = statements[0]!;
  const last = statements[statements.length - 1]!;
  if (last === first) return { after: last.after, before: last.before };
  return { after: last.after, before: first.before ?? first.after };
}

const total = (classes: ShareClass[] | null) => (classes && classes.length ? classes.reduce((a, c) => a + c.count, 0) : null);

/** Shares issued as stated ("par l'émission de 100 actions … et 30 actions …"), summed over classes. */
function issuedShares(text: string, lang: string): number | null {
  const seg = /(?:par l['’]émission de|émission de|Ausgabe von|emissione di)\s+([\s\S]*?)(?:,\s*(?:dont|toutes|entièrement|libérées)|\.\s+(?=[A-ZÉÈÄÖÜ])|\.?$)/i.exec(text);
  if (!seg) return null;
  const items = parseShareItems(seg[1]!, lang);
  if (items.length) return total(items);
  // Only shares count: GmbH quotas ("80 parts sociales") are not shares.
  const n = /^(\d[\d’']*)\s+(?:nouvelles\s+)?(?:actions|Aktien|Namenaktien|Inhaberaktien|azioni)\b/i.exec(seg[1]!.trim());
  return n ? Number(num(n[1]!)) : null;
}

// ---- contribution type ---------------------------------------------------------------------

const IN_KIND = /Sacheinlage|Sachübernahme|apport en nature|reprise de biens|conferimento in natura|assunzione di beni/i;
// Issuance out of conditional capital; adopting or amending the clause is not an issuance.
const CONDITIONAL_ISSUANCE = /aus bedingtem (?:Aktien)?[Kk]apital|au moyen d['’]un capital conditionnel|mediante (?:il )?capitale condizionale/i;
const CASH = /\bin bar\b|en espèces|in contanti/i;
const SET_OFF_AMOUNT = new RegExp(
  `(?:Forderung(?:en)?|créances?|crediti?)[^.;]{0,40}?(?:in der Höhe von(?:\\s+insgesamt)?|von|de|di|à hauteur de)\\s+${CUR}\\s+(\\d[\\d’']*(?:[.,]\\s?\\d{1,2})?)`,
  "i",
);
const SET_OFF_SHARES = /(?:wofür|il est remis|per cui)\s+(\d[\d’']*)\s+(?:[\p{L}-]+\s+){0,3}?(?:Namenaktien|Inhaberaktien|Aktien|actions|azioni)|dont\s+(\d[\d’']*)\s+actions[^,;.]{0,60}?libérées? par compensation/iu;

/**
 * Contribution type of an increase, read from the active text (see activeText). "mixed" means
 * a non-cash contribution plus cash, so new money is present; a set-off covering fewer shares
 * than were issued implies the rest was paid in cash.
 */
export function contributionOf(text: string, issuedTotal: number | null = null): ContributionType {
  const t = activeText(text);
  const isSetOff = SET_OFF.test(t);
  const inKind = IN_KIND.test(t);
  const so = SET_OFF_SHARES.exec(t);
  const setOffCount = so ? Number(num(so[1] ?? so[2]!)) : null;
  const partial = setOffCount !== null && issuedTotal !== null && setOffCount < issuedTotal;
  const cash = CASH.test(t) || partial;
  if ((isSetOff || inKind) && cash) return "mixed";
  if (isSetOff) return "set_off";
  if (inKind) return "in_kind";
  const issuanceClauses = splitClauses(t).map((c) => c.text).filter((c) => !ADOPTION_NOTICE.test(c)).join(" ");
  if (CONDITIONAL_ISSUANCE.test(issuanceClauses)) return "conditional_capital";
  // Contributions in kind and set-offs are qualified facts that must be published (OR 650/HRegV);
  // an ordinary increase without them is paid in cash.
  return "cash";
}

// ---- restructuring pair --------------------------------------------------------------------

const REDUCTION = /Kapitalherabsetzung|Herabsetzung des Aktienkapitals|réduction (?:ordinaire )?du capital|capital-actions réduit|riduzione (?:ordinaria )?del capitale/i;
const EXECUTED_INCREASE = /ordentliche Kapitalerhöhung|Ordentliche (?:Erhöhung|Kapitalerhöhung)|Wiedererhöhung|Augmentation ordinaire|aumento ordinario/i;
// The pair is the accordion operation: reduce (usually to absorb losses) and re-increase at once.
const SAME_OPERATION = /gleichzeitig|Wiedererhöhung|Unterbilanz|Überschuldung|Verlust|simultané|immédiatement|en vue de (?:la )?(?:compensation|couverture) de(?:s)? pertes|pertes|contemporaneamente|perdite/i;
const TREASURY_ONLY = /eigene(?:n)? Aktien|actions propres|azioni proprie/i;
const FRENCH_CURRENCY_BEFORE = new RegExp(`monnaie du capital-actions de\\s+${CUR}\\b`, "i");

/**
 * The capital's previous currency when this entry changes it, else null. German entries show it
 * in the share classes ("[bisher: … zu CHF 1.00]" is parsed into classesBefore); the old French
 * format states it in prose ("La monnaie du capital-actions de CHF … a été convertie").
 */
function capitalCurrencyBefore(active: string, classesBefore: ShareClass[] | null, classesAfter: ShareClass[] | null): ShareClass["currency"] | null {
  const after = new Set((classesAfter ?? []).map((c) => c.currency));
  const changedClass = (classesBefore ?? []).find((c) => after.size > 0 && !after.has(c.currency));
  if (changedClass) return changedClass.currency;
  const m = REDENOMINATION.test(active) ? FRENCH_CURRENCY_BEFORE.exec(active) : null;
  if (m) return m[1] as ShareClass["currency"];
  return null;
}
const REDENOMINATION =
  /monnaie du capital[\s\S]{0,200}?(?:a été )?converti|Währung des (?:Aktien)?[Kk]apitals[\s\S]{0,200}?(?:umgestellt|umgewandelt|geändert)|Umstellung (?:der Währung|des Aktienkapitals auf)|valuta del capitale[\s\S]{0,200}?convertit/i;

// ---- main ----------------------------------------------------------------------------------

export function parsePublication(xml: string): ParsedPublication {
  const id = textAt(xml, ["meta", "id"]);
  const publicationNumber = textAt(xml, ["meta", "publicationNumber"]);
  const publishedAt = textAt(xml, ["meta", "publicationDate"])?.slice(0, 10);
  if (!id || !publicationNumber || !publishedAt) throw new ParseError("missing meta id, number or publication date");
  const subRubric = textAt(xml, ["meta", "subRubric"]) ?? "";
  const language = textAt(xml, ["meta", "language"]) ?? "de";
  const text = textAt(xml, ["content", "publicationText"]) ?? "";
  const journalDate = textAt(xml, ["content", "journalDate"]) ?? null;
  const warnings: string[] = [];

  const nu = (p: string[]) => textAt(xml, ["commonsNew", ...p]);
  const ac = (p: string[]) => textAt(xml, ["commonsActual", ...p]);
  const companyUid = publicationUid(xml);
  if (!companyUid) warnings.push("no company UID");
  const companyName = nu(["company", "name"]) ?? "";
  const previousNameRaw = ac(["company", "name"]) ?? null;
  const legalForm = nu(["company", "legalForm"]) ?? null;
  const previousLegalForm = ac(["company", "legalForm"]) ?? null;
  const purpose = nu(["purpose"]) ?? "";

  const clauses = clausesOf(text);
  const active = activeText(text);

  // Legal date: the date in the statutes clause, else the journal date.
  const statutes = clauses.find((c) => c.kind === "statutes");
  const statuteDate = statutes ? parseSwissDate(statutes.text) : null;
  if (statutes && !statuteDate) warnings.push("statutes clause without a readable date");
  let legalDate = statuteDate ?? journalDate ?? publishedAt;
  if (!isIsoDate(legalDate) || legalDate > publishedAt || legalDate < addDays(publishedAt, -3650)) {
    warnings.push(`implausible legal date ${legalDate}; using the publication date`);
    legalDate = publishedAt;
  }

  // Corrections cite the corrected entry: DE by "Meldungsnummer", FR/IT by a FOSC date that
  // must match the header's previous-publication reference.
  const correction = clauses.find((c) => c.kind === "correction");
  let correctsPublicationNumber: string | null = null;
  if (correction) {
    const de = /Meldungsnummer\s+(\d{7,})/.exec(text);
    if (de) correctsPublicationNumber = `HR02-${de[1]}`;
    else {
      const header = clauses.find((c) => c.kind === "header")?.text ?? "";
      const ref = /(?:Publ\.|Pubbl\.)\s*(\d{7,})|p\.\s*\d+\/(\d{7,})/.exec(header);
      const corrDate = [...correction.text.matchAll(/(\d{2}\.\d{2}\.\d{4})/g)].pop()?.[1];
      if (ref && corrDate && header.includes(corrDate)) correctsPublicationNumber = `HR02-${ref[1] ?? ref[2]}`;
    }
    if (!correctsPublicationNumber) warnings.push("correction without a verifiable cited publication number");
  }

  const events: ParsedEvent[] = [];
  const cancel = /(?:Annullierung|annulliert|annulée?|annullata)[\s\S]{0,200}?(?:Meldungsnummer|Publ\.|Pubbl\.|p\.\s*\d+\/)\s*(\d{10})/i.exec(text);
  if (cancel) events.push({ type: "cancellation", payload: { cancelsPublicationNumber: `HR02-${cancel[1]}` } });

  // An HR01 after a move to another canton's register is a re-registration, not a founding.
  const seatTransfer = /Sitzverlegung|bisher im Handelsregister|vormals im Handelsregister|transfert du siège|précédemment inscrite|trasferimento della sede|precedentemente iscritt/i.test(text);
  if (subRubric === "HR01" && !seatTransfer) events.push({ type: "formation", payload: { purpose, foundedOn: legalDate } });

  const before = decimal(ac(["capital", "nominal"]));
  const after = decimal(nu(["capital", "nominal"]));
  const conversion = previousLegalForm === LEGAL_FORM.GMBH && legalForm === LEGAL_FORM.AG;
  if (conversion) events.push({ type: "conversion_to_ag", payload: { fromLegalForm: previousLegalForm!, toLegalForm: legalForm! } });

  const capitalFlag = section(xml, "capitalChanged");
  const nominalChangedFlag = capitalFlag ? /<nominal>true<\/nominal>/.test(capitalFlag) : false;
  const participation = /Partizipationskapital|capital-participation|capitale di partecipazione/i.test(active) && !/Aktienkapital|capital-actions|capitale azionario/i.test(active);
  // A reduction and re-increase can leave nominal capital unchanged, so wording counts too.
  const capitalWording = REDUCTION.test(active) || EXECUTED_INCREASE.test(active) || /Kapitalerhöhung|augmentation (?:autorisée|du capital)|aumento del capitale/i.test(active);

  if (subRubric !== "HR01" && before !== null && after !== null && (before !== after || nominalChangedFlag || capitalWording)) {
    const segs = shareSegments(text, language);
    const classesAfter = segs.after ? parseShareItems(segs.after, language) : null;
    const classesBefore = segs.before ? parseShareItems(segs.before, language) : null;
    const sharesIssued = issuedShares(active, language);
    const reductionClauses = splitClauses(active).map((c) => c.text).filter((c) => REDUCTION.test(c));
    const treasuryOnly = reductionClauses.length > 0 && reductionClauses.every((c) => TREASURY_ONLY.test(c));
    const pair = reductionClauses.length > 0 && EXECUTED_INCREASE.test(active) && SAME_OPERATION.test(active) && !treasuryOnly;
    // A change of capital currency (CHF 105'000 → USD 124'136.25) puts the two nominal figures in
    // different currencies: they can't be compared. The step is an increase only when the entry
    // says one was executed ("Ordentliche Kapitalerhöhung", "aus bedingtem Kapital"); a plain
    // redenomination, even one that re-splits the shares to keep the nominal, issues nothing.
    const currencyBefore = capitalCurrencyBefore(active, classesBefore, classesAfter);
    const statedIncrease = EXECUTED_INCREASE.test(active) || CONDITIONAL_ISSUANCE.test(active);
    const direction = currencyBefore
      ? statedIncrease
        ? "increase"
        : "unchanged"
      : Number(after) > Number(before)
        ? "increase"
        : Number(after) < Number(before)
          ? "reduction"
          : "unchanged";
    const sharesAfter = total(classesAfter);
    let sharesBefore = total(classesBefore);
    if (sharesBefore === null && sharesIssued !== null && sharesAfter !== null && !pair && direction === "increase") {
      sharesBefore = sharesAfter - sharesIssued;
      if (sharesBefore < 0) {
        warnings.push(`issued shares (${sharesIssued}) exceed the new total (${sharesAfter})`);
        sharesBefore = null;
      }
    }
    // Unchanged nominal capital is an event only as a restructuring pair or a share split.
    const shareCountChanged = sharesBefore !== null && sharesAfter !== null && sharesBefore !== sharesAfter;
    const emit = direction !== "unchanged" || pair || shareCountChanged;
    if (emit) {
      // GmbH quotas ("parts sociales", "Stammanteile") are not shares; conversions show no issuance figure.
      if (classesAfter && classesAfter.length === 0 && !/parts sociales|Stammanteile|quote sociali/i.test(segs.after ?? "")) {
        warnings.push("share segment found but no share items parsed");
      }
      const nominalsBefore = new Set((classesBefore ?? []).map((c) => c.nominal));
      const nominalsAfter = new Set((classesAfter ?? []).map((c) => c.nominal));
      const nominalChanged =
        classesBefore !== null && classesAfter !== null && [...nominalsAfter].some((n) => !nominalsBefore.has(n)) && [...nominalsBefore].some((n) => !nominalsAfter.has(n));
      const prefBefore = preferredLabels(classesBefore);
      // Without the previous classes (old French format) "new" is unknowable here: the history
      // fold (T5) compares against the company's previous capital event.
      const newPreferredClass = classesBefore === null ? null : [...preferredLabels(classesAfter)].some((k) => !prefBefore.has(k));
      const so = SET_OFF_AMOUNT.exec(active);
      // Case-sensitive and word-bounded: "valeur" must not read as EUR.
      const currencyMatch =
        new RegExp(`(?:[Aa]ktienkapital neu|[Ss]tammkapital|[Cc]apital-actions|[Cc]apital social|[Cc]apitale azionario)[^:]{0,60}?:?\\s*\\b${CUR}\\b`).exec(text) ??
        new RegExp(`\\b${CUR}\\b`).exec(active);
      if (!currencyMatch) warnings.push("capital currency not found; assumed CHF");
      events.push({
        type: "capital_change",
        contributionType: direction === "increase" ? contributionOf(text, sharesIssued ?? (sharesBefore !== null && sharesAfter !== null ? sharesAfter - sharesBefore : null)) : "unknown",
        currency: (currencyMatch?.[1] as ShareClass["currency"]) ?? "CHF",
        capitalBefore: before,
        capitalAfter: after,
        sharesBefore,
        sharesAfter,
        payload: {
          direction,
          restructuringPair: pair,
          withConversion: conversion,
          withinCapitalBand: /innerhalb des Kapitalband|dans (?:les limites|la limite) de la marge de fluctuation|nei limiti del margine/i.test(text),
          paidBefore: decimal(ac(["capital", "paid"])),
          paidAfter: decimal(nu(["capital", "paid"])),
          classesBefore,
          classesAfter,
          sharesIssued,
          setOffAmount: so ? num(so[2]!) : null,
          setOffCurrency: so ? (so[1] as ShareClass["currency"]) : null,
          newPreferredClass,
          nominalChanged,
          participationCapital: participation,
          currencyBefore,
        },
      });
    }
  }

  if (CAPITAL_BAND.test(text)) {
    const removed = /\[gestrichen:[^\]]*Kapitalband|Kapitalband[^.]*(?:gestrichen|aufgehoben)|supprimé une clause statutaire relative à une marge|Suppression de la clause statutaire relative à une marge|marge de fluctuation[^.]*supprimée?/i.test(text);
    const adopted = /ein Kapitalband gemäss|Kapitalband gemäss näherer Umschreibung|introduit une clause statutaire relative à une marge|ha introdotto[^.]*margine/i.test(text);
    const changed = /Kapitalband[^.]*geändert|modifié une clause statutaire relative à une marge/i.test(text);
    if (removed || adopted || changed) {
      events.push({ type: "capital_band", payload: { action: adopted ? (changed ? "changed" : "adopted") : removed ? "removed" : "changed" } });
    }
  }

  const previousName = previousNameRaw && previousNameRaw !== companyName ? previousNameRaw : null;
  if (previousName) events.push({ type: "name_change", payload: { from: previousName, to: companyName } });

  for (const e of events) {
    const r = parsedEvent.safeParse(e);
    if (!r.success) throw new ParseError(`invalid ${e.type} event in ${publicationNumber}: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }

  return {
    id,
    publicationNumber,
    rubric: textAt(xml, ["meta", "rubric"]) ?? "HR",
    subRubric,
    language,
    publishedAt,
    journalDate,
    companyUid,
    companyName,
    previousName,
    legalForm,
    previousLegalForm,
    seat: nu(["company", "seat"]) ?? "",
    canton: textAt(xml, ["meta", "cantons"])?.split(/[,\s]+/)[0] ?? null,
    purpose,
    legalDate,
    correctsPublicationNumber,
    capitalBefore: before,
    capitalAfter: after,
    text,
    clauses,
    events,
    warnings,
  };
}
