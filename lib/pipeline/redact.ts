// Classifier input (T7): the facts of one capital change, redacted before the model sees them.
// Removed: the UID, current and former names (DE/FR/IT forms and their distinctive words),
// natural persons, street addresses, the seat town, URLs/emails; brand words are scrubbed from
// the purpose (eng T2b). A fixture test proves it (plan "Redaction").
import { createHash } from "node:crypto";
import type { AgeBucket } from "../domain/coverage";
import type { CapitalEvent, ShareClass } from "../domain/events";
import { getRule, type RuleId } from "../domain/rule-catalog";
import { maskInlinePersons } from "./clauses";


export interface ClassifierInput {
  legalForm: "AG/SA";
  canton: string | null;
  companyAge: AgeBucket;
  currency: string;
  nominalCapitalBefore: string;
  nominalCapitalAfter: string;
  sharesBefore: number | "unknown";
  sharesAfter: number | "unknown";
  shareClassesAfter: { count: number; nominal: string; preferred: boolean; label: string | null }[] | "unknown";
  newPreferredClass: boolean | "unknown";
  contribution: string;
  withinCapitalBand: boolean;
  duringConversionFromGmbH: boolean;
  purpose: string;
  firedRules: { id: RuleId; description: string }[];
}

const LEGAL_SUFFIX = /\b(AG|SA|Ltd\.?|GmbH|Sàrl|Sagl|S\.A\.|Inc\.?|Holding|in Liquidation|en liquidation)\b/gi;
const COMMON = new Set(
  "swiss schweiz suisse svizzera group gruppe groupe gruppo holding health medical medtech therapeutics technologies technology tech solutions services systems capital invest investments partners management consulting digital energy power bio pharma labs lab software data international global ag sa ltd gmbh sàrl sagl the and und et e di de la le les der die das".split(" "),
);

/** Names to remove: each full name, its suffix-free stem and its distinctive (non-generic) words. */
export function nameTerms(names: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const raw of names) {
    // "X AG (X SA) (X Ltd)": every bracketed translation is a name too.
    for (const n of [raw, ...[...raw.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!)]) {
      const name = n.replace(/\([^)]*\)/g, "").trim();
      if (!name) continue;
      terms.add(name);
      const stem = name.replace(LEGAL_SUFFIX, "").replace(/\s+/g, " ").trim();
      if (stem.length >= 3) terms.add(stem);
      for (const w of stem.split(/[\s\-&.,/]+/)) if (w.length >= 4 && !COMMON.has(w.toLowerCase())) terms.add(w);
    }
  }
  return [...terms].sort((a, b) => b.length - a.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STREET = /\b[\p{L}-]*(?:strasse|straße|gasse|weg|platz|allee|ring|rain|matt)\s+\d+[a-z]?\b|\b(?:rue|route|avenue|av\.|chemin|ch\.|place|boulevard|quai|via|viale|piazza|vicolo)\s+[^,;.]{2,40}?\s+\d+[a-z]?\b/giu;
const POSTCODE_TOWN = /\b\d{4}\s+[A-ZÄÖÜÉÈ][\p{L}-]+(?:\s+[A-ZÄÖÜÉÈ][\p{L}-]+)?/gu;
const UID = /\bCHE-?\d{3}\.?\d{3}\.?\d{3}\b/g;
const URL_EMAIL = /\b(?:https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+|[\w-]+\.(?:ch|com|io|ai|swiss|net|org)\b)/gi;

export function redactText(text: string, names: readonly string[], seat: string | null): string {
  let out = maskInlinePersons(text).replace(/<PERSON_\d+>/g, "[person]");
  for (const t of nameTerms(names)) out = out.replace(new RegExp(`(?<![\\p{L}\\d])${escape(t)}(?![\\p{L}\\d])`, "giu"), "[company]");
  if (seat) out = out.replace(new RegExp(`(?<![\\p{L}])${escape(seat.replace(/\s*\(.*\)$/, ""))}(?![\\p{L}])`, "giu"), "[town]");
  return out.replace(UID, "[uid]").replace(URL_EMAIL, "[link]").replace(STREET, "[address]").replace(POSTCODE_TOWN, "[town]");
}

const classLabel = (c: ShareClass, names: readonly string[], seat: string | null) => (c.label ? redactText(c.label, names, seat) : null);

export function buildClassifierInput(args: {
  event: CapitalEvent;
  sharesBefore: number | null;
  newPreferredClass: boolean | null;
  ageBucket: AgeBucket;
  canton: string | null;
  purpose: string;
  /** Every name the company has carried (current and former, all language forms). */
  names: readonly string[];
  seat: string | null;
  firedRuleIds: readonly RuleId[];
}): ClassifierInput {
  const e = args.event;
  return {
    legalForm: "AG/SA",
    canton: args.canton,
    companyAge: args.ageBucket,
    currency: e.currency,
    nominalCapitalBefore: e.capitalBefore,
    nominalCapitalAfter: e.capitalAfter,
    sharesBefore: args.sharesBefore ?? "unknown",
    sharesAfter: e.sharesAfter ?? "unknown",
    shareClassesAfter: e.payload.classesAfter?.map((c) => ({ count: c.count, nominal: c.nominal, preferred: c.preferred, label: classLabel(c, args.names, args.seat) })) ?? "unknown",
    newPreferredClass: args.newPreferredClass ?? "unknown",
    contribution: e.contributionType,
    withinCapitalBand: e.payload.withinCapitalBand,
    duringConversionFromGmbH: e.payload.withConversion,
    purpose: redactText(args.purpose, args.names, args.seat),
    firedRules: args.firedRuleIds.map((id) => ({ id, description: getRule(id)!.claude })),
  };
}

/** Canonical JSON (sorted keys) → sha256: the idempotency key's input part. */
export function inputHash(input: ClassifierInput): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
}
