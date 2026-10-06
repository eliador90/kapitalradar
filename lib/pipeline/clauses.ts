// Splits a SHAB publication text into clauses and classifies them. One definition serves the
// parser, the scrubbed test fixtures and (later) the rendered excerpts, which may show only
// company-level clauses (eng A5). Privacy wins over classification: any clause that looks like
// person data is "person", whatever else it mentions.

export const CLAUSE_KINDS = [
  "header", // company, seat, UID, previous publication
  "correction", // "Berichtigung des … publizierten …" / "Rectification de …"
  "statutes", // statute-change date
  "capital", // nominal / paid capital, capital increase or reduction wording
  "shares", // share counts and classes
  "contribution", // set-off, contribution in kind, conditional capital (qualified facts)
  "band", // capital band
  "conversion", // GmbH/Sàrl → AG/SA
  "name", // new company name and translations
  "purpose",
  "person", // natural persons, signatures: never kept outside .data/
  "other",
] as const;
export type ClauseKind = (typeof CLAUSE_KINDS)[number];

export interface Clause {
  kind: ClauseKind;
  text: string;
  /** Character offsets in the original text (evidence spans). */
  start: number;
  end: number;
}

export const UID_IN_TEXT = /\bCHE-\d{3}\.\d{3}\.\d{3}\b/;
export const CORRECTION_HEAD = /^(Berichtigung|Rectification|Rettifica)\b/i;
export const STATUTES_HEAD =
  /^(Statutenänderung|Statuten neu|Statuten:|Statuts modifiés|Modification des statuts|Nouveaux statuts|Statuts du|Statuts:|Statuti modificati|Nuovi statuti|Statuti:)/i;

// A boundary is ". " followed by an upper-case letter, "[" or a name particle ("von Muralt",
// "de Weck"), unless the dot ends an abbreviation. Company suffixes (AG., SA.) do end sentences.
const ABBREV = /(?:\b(?:Nr|No|Publ|p|art|Art|al|ch|lit|bzw|ca|resp|S|N|Ziff|chiffre|cf|vgl|vol|St|Fr|sig|Mio|mio|Dr|Prof|Hr|M|Mme|ing|dipl|lic|rer|pol|oec|med|iur|phil|nat|techn|sc)\.)$/;
const BOUNDARY = /\.\s+(?=[A-ZÄÖÜÉÈÀÂÎÔÛ[]|(?:von|van|de|di|da|d['’])\s*[A-ZÄÖÜÉÈ])/g;

export function splitClauses(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let start = 0;
  for (const m of text.matchAll(BOUNDARY)) {
    const end = m.index! + 1; // keep the dot
    if (ABBREV.test(text.slice(Math.max(start, end - 12), end))) continue;
    out.push({ text: text.slice(start, end), start, end });
    start = m.index! + m[0].length;
  }
  if (start < text.length && text.slice(start).trim()) out.push({ text: text.slice(start).trimEnd(), start, end: text.trimEnd().length });
  return out;
}

const PERSON = [
  /^(Eingetragene Personen|Ausgeschiedene Personen|Personne(s)? (inscrite|radiée|et signature)|Personnes? inscrites?|Inscription ou modification de personne|Nouvelles personnes|Persone iscritte|Nuove persone|Persone radiate|Revisionsstelle|Organe de révision|Administration:)/i,
  /\b(signe(nt)?|signature|unterzeichnet|Unterschrift|Zeichnungsberechtigung|firma (collettiva|individuale))\b/i,
  /\b(est|sont) (nommée?s?|maintenant|désormais|membres?|président|radiée?s?)\b|n'(est|sont) plus\b/i,
  /\b(Staatsangehörige?r?|von [A-ZÄÖÜ][\p{L}-]+, in [A-ZÄÖÜ]|de [A-ZÉ][\p{L}-]+, à [A-ZÉ]|da [A-Z][\p{L}-]+, in [A-Z])/u,
  /\b(Mitglied|Präsident(in)?|Geschäftsführer(in)?|Prokurist(in)?|administrateur|administratrice|gérant|directeur|directrice|membro|presidente)\b/i,
  /\bDr\.\s*(med\.\s*)?[A-ZÄÖÜ]/,
];

const RULES: [ClauseKind, RegExp][] = [
  ["correction", CORRECTION_HEAD],
  ["statutes", STATUTES_HEAD],
  ["purpose", /^(Zweck neu|Zweck:|But:|Nouveau but|Scopo)/i],
  ["name", /^(Firma neu|Uebersetzungen der Firma|Übersetzungen der Firma|Nouvelle raison|Traductions de la raison|Nuova ragione)/i],
  ["conversion", /\b(Umwandlung|umgewandelt|Rechtsform neu|Transformation|transformée?|Nouvelle (forme|nature) juridique|trasformazione|trasformata)\b/i],
  ["band", /\b(Kapitalband|marge de fluctuation|margine di variazione)\b/i],
  ["contribution", /\b(Qualifizierte Tatbestände|Sacheinlage|Sachübernahme|Verrechnung|verrechnet|compensation de créance|apport en nature|reprise de biens|conferimento in natura|compensazione|bedingte[nms]? (Aktien)?[Kk]apital|capital conditionnel|augmentation conditionnelle|capitale condizionale)/i],
  ["shares", /\b(Aktien neu|Namenaktien|Inhaberaktien|Partizipationsscheine|Nouvelles actions|actions (nominatives|au porteur|ordinaires|privilégiées)|divisé en|Nuove azioni|azioni nominative)/i],
  ["capital", /\b(Aktienkapital|Stammkapital|Partizipationskapital|Liberierung|Kapitalerhöhung|Kapitalherabsetzung|Herabsetzung|capital-actions|capital social|capital-participation|augmentation|réduction|capitale azionario|aumento|riduzione)\b/i],
];

export function classifyClause(text: string, index: number): ClauseKind {
  if (index === 0 && UID_IN_TEXT.test(text)) return CORRECTION_HEAD.test(text) ? "correction" : "header";
  if (PERSON.some((re) => re.test(text))) return "person";
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return "other";
}

export function clausesOf(text: string): Clause[] {
  const out: Clause[] = [];
  for (const [i, c] of splitClauses(text).entries()) {
    // A correction notice comes first; the company header (with UID) follows it.
    const afterCorrection = i === 1 && out[0]?.kind === "correction" && UID_IN_TEXT.test(c.text);
    out.push({ ...c, kind: afterCorrection ? "header" : classifyClause(c.text, i) });
  }
  return out;
}

// ---- inline person masking (eng A6) ---------------------------------------------------------

const NAME = String.raw`[A-ZÄÖÜÉÈ][\p{L}'’-]+(?:,?\s+(?:de |von |van |da |di |le |la )?[A-ZÄÖÜÉÈ][\p{L}'’-]+){1,3}`;
const ROLE = String.raw`(?:associée?s?|associé-gérant|associée-gérante|actionnaires?|gérante?s?|fondateurs?|fondatrices?|Gesellschafter(?:in|innen)?|Aktionär(?:in|innen|e)?|Gründer(?:in|innen)?|socio|soci|azionisti?)`;
const ROLE_ADJ = String.raw`(?:(?:unique|seule?|einzige[nr]?|unico|unica)\s+)?`;
const INLINE_PATTERNS = [
  // "souscrites par l'associé (unique) X Y", "an den Gesellschafter X Y"
  new RegExp(String.raw`((?:par|à|pour|de|an|von|durch|für|da|a)\s+(?:l['’]|le |la |les |den |die |dem |der |il )?` + ROLE_ADJ + ROLE + String.raw`\s+` + ROLE_ADJ + ")(" + NAME + ")", "gu"),
  // "contre attribution à X Y de …", "übernommen von X Y"
  new RegExp(String.raw`((?:attribution à|souscrites? par|apportée?s? par|übernommen von|gezeichnet von|eingebracht von)\s+)(` + NAME + ")", "gu"),
  // Sole proprietorships named after their owner: "das Einzelunternehmen X Y Schreinerei"
  new RegExp(String.raw`((?:Einzelunternehmen|entreprise individuelle|ditta individuale)\s+["«]?)(` + NAME + ")", "gu"),
  // Care-of contacts in addresses
  new RegExp(String.raw`(c/o\s+)(` + NAME + ")", "gu"),
];

export function maskInlinePersons(text: string): string {
  let n = 0;
  let out = text;
  for (const re of INLINE_PATTERNS) out = out.replace(re, (_m, lead: string) => `${lead}<PERSON_${++n}>`);
  return out;
}

/** Company-level clauses only (no person clauses, nothing unclassified, inline names masked). */
export function companyLevelText(text: string): string {
  return maskInlinePersons(
    clausesOf(text)
      .filter((c) => c.kind !== "person" && c.kind !== "other")
      .map((c) => c.text)
      .join(" "),
  );
}

// ---- person-data gate (design line 213) -----------------------------------------------------

const GATE = [
  { rule: "register person format", re: /\b[A-ZÄÖÜÉÈ][\p{L}'-]+, [A-ZÄÖÜÉÈ][\p{L}'-]+(?: [A-ZÄÖÜÉÈ][\p{L}'-]+)?, (?:von|de|da|aus) [A-ZÄÖÜÉÈ]/u },
  { rule: "role followed by a name", re: new RegExp(ROLE + String.raw`\s+` + ROLE_ADJ + String.raw`(?!<PERSON)[A-ZÄÖÜÉÈ][\p{L}'’-]+\s+[A-ZÄÖÜÉÈ][\p{L}'’-]+`, "u") },
  { rule: "doctor title", re: /\bDr\.\s*(?:med\.\s*)?[A-ZÄÖÜ][a-zäöü]/ },
  { rule: "care-of contact", re: /c\/o\s+(?!<PERSON)[A-ZÄÖÜÉÈ][\p{L}'’-]+\s+[A-ZÄÖÜÉÈ]/u },
  { rule: "person clause", re: /Eingetragene Personen|Ausgeschiedene Personen|Personnes? inscrites?|Persone iscritte/i },
];

/** Person-data patterns not covered by a scrub token; empty means the text passes the gate. */
export function personDataHits(text: string): string[] {
  return GATE.filter((g) => g.re.test(text)).map((g) => g.rule);
}
