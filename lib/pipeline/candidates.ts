// Per-company assembly shared by the dev eval, classifier runs and the release build: parsed
// publications → fold → rule evaluation → redacted classifier input for each capital change.
import { and, eq, gte } from "drizzle-orm";
import { db } from "../../db/client";
import { companySources, publications } from "../../db/schema";
import type { CapitalEvent } from "../domain/events";
import { foldCapitalContext, type CapitalContext } from "./fold";
import { parsePublication, type ParsedPublication } from "./parse";
import { buildClassifierInput, inputHash, type ClassifierInput } from "./redact";
import { LEGAL_FORM } from "./xml";
import { evaluateRules, type RuleConfig, type RuleEvaluation } from "./rules";


export interface CapitalCandidate {
  publication: ParsedPublication;
  event: CapitalEvent;
  context: CapitalContext;
  rules: RuleEvaluation;
  input: ClassifierInput;
  inputHash: string;
}

export interface CompanyBundle {
  uid: string;
  publications: ParsedPublication[];
  foundedOn: string | null;
  names: string[];
  capitalChanges: CapitalCandidate[];
  parseFailures: { id: string; message: string }[];
}

export function assembleCompany(uid: string, pubs: ParsedPublication[], foundedOn: string | null, ruleConfig?: RuleConfig): Omit<CompanyBundle, "parseFailures"> {
  const nameOf = (p: ParsedPublication) => [p.companyName, p.previousName].filter((n): n is string => Boolean(n));
  const names = [...new Set(pubs.flatMap(nameOf))];
  const contexts = foldCapitalContext(pubs, foundedOn);
  const capitalChanges: CapitalCandidate[] = [];
  for (const p of pubs) {
    // Feature rule: an event's input may use only names published on or before it.
    const namesSoFar = [...new Set(pubs.filter((q) => q.publishedAt <= p.publishedAt).flatMap(nameOf))];
    for (const event of p.events) {
      if (event.type !== "capital_change") continue;
      const context = contexts.get(p.publicationNumber)!;
      const rules = evaluateRules({ event, context, purpose: p.purpose, legalForm: p.legalForm }, ruleConfig);
      const input = buildClassifierInput({
        event,
        sharesBefore: context.sharesBefore,
        newPreferredClass: context.newPreferredClass,
        ageBucket: context.ageBucket,
        canton: p.canton,
        purpose: p.purpose,
        names: namesSoFar,
        seat: p.seat,
        firedRuleIds: rules.hits,
      });
      capitalChanges.push({ publication: p, event, context, rules, input, inputHash: inputHash(input) });
    }
  }
  return { uid, publications: pubs, foundedOn, names, capitalChanges };
}

/** Plan "Backfill": from 2025-08-01 to the release snapshot. */
export const BACKFILL_START = "2025-08-01";

/**
 * AG companies with a capital increase published in the backfill window. Restricted to the
 * window and to the company's own entries, so history fetched for one company (older entries,
 * foreign mentions) never grows the candidate set.
 */
export async function listCandidateUids(from = BACKFILL_START): Promise<string[]> {
  const uids = new Set<string>();
  let parseFailures = 0;
  for (let offset = 0; ; offset += 500) {
    const page = await db()
      .select({ xml: publications.rawXml, uid: publications.companyUid })
      .from(publications)
      .where(and(eq(publications.subRubric, "HR02"), gte(publications.publishedAt, from)))
      .orderBy(publications.id)
      .limit(500)
      .offset(offset);
    if (!page.length) break;
    for (const { xml, uid } of page) {
      try {
        const p = parsePublication(xml);
        const increase = p.events.some((e) => e.type === "capital_change" && e.payload.direction === "increase");
        if (increase && p.legalForm === LEGAL_FORM.AG && p.companyUid && p.companyUid === uid) uids.add(p.companyUid);
      } catch {
        parseFailures++;
      }
    }
  }
  if (parseFailures) console.warn(`${parseFailures} stored publications failed to parse and were skipped`);
  return [...uids].sort();
}

/** Loads a company from Neon. Parse failures are returned, not swallowed. */
export async function loadCompany(uid: string, ruleConfig?: RuleConfig): Promise<CompanyBundle> {
  const [source] = await db().select().from(companySources).where(eq(companySources.companyUid, uid));
  const pubs: ParsedPublication[] = [];
  const parseFailures: { id: string; message: string }[] = [];
  for (const r of await db().select({ id: publications.id, xml: publications.rawXml }).from(publications).where(eq(publications.companyUid, uid))) {
    try {
      pubs.push(parsePublication(r.xml));
    } catch (e) {
      parseFailures.push({ id: r.id, message: (e as Error).message });
    }
  }
  return { ...assembleCompany(uid, pubs, source?.foundedOn ?? null, ruleConfig), parseFailures };
}
