// Rules (T6): the pre-filter, named rule hits and the rules-only score for one capital change.
// Every parsed capital change gets an evaluation, rejects included (eng Q2); hard negatives
// exclude a candidate, all other negatives are soft weights (eng Q1). Unknown company age
// fires no age rule (weight 0, eng Q4).
import type { AgeBucket } from "../domain/coverage";
import type { CapitalEvent } from "../domain/events";
import { RULES, type RuleId } from "../domain/rule-catalog";
import { loadClassificationConfig } from "./config";
import type { CapitalContext } from "./fold";
import { LEGAL_FORM } from "./xml";


export interface RuleInput {
  event: CapitalEvent;
  context: CapitalContext;
  purpose: string;
  legalForm: string | null;
}

export interface RuleConfig {
  weights: Record<string, number>;
  /** Rules-only positive at score >= threshold (chosen on dev data). */
  threshold: number;
}

export interface RuleEvaluation {
  hits: RuleId[];
  score: number;
  /** Passed the pre-filter: AG, an increase, no hard negative. */
  candidate: boolean;
  rejectReason: "not_ag" | "not_increase" | "restructuring_pair" | "capital_reduction" | null;
  rulesPositive: boolean;
  ageBucket: AgeBucket;
}

/** Catalog weights with the given threshold, else the frozen one from config/classification.json. */
export const defaultRuleConfig = (threshold?: number): RuleConfig => ({
  weights: Object.fromEntries(RULES.map((r) => [r.id, r.weight])),
  threshold: threshold ?? loadClassificationConfig().rulesThreshold,
});

// DE/FR/IT/EN wording for technology and life-sciences development in a statutory purpose.
// Word-bounded on purpose: "Mandaten", "Parzellen", "Informationen", "Gebäudetechnik" or
// "Physiotherapie" are not tech; generic "Entwicklung von" (real estate too) is not either.
export const TECH_PURPOSE =
  /\b(?:software|logiciels?|numériques?|informatik|informatique|informatica|digitale?n?\b|digital(?:isierung|isation)|(?:online-|software-|digitale\s)?plattform|plateforme (?:numérique|digitale|en ligne|logicielle)|piattaform[ae] digital|technologie[ns]?|technologique|tecnologi[ae]|\bKI\b|\bIA\b|künstliche[nr]? Intelligenz|intelligence artificielle|intelligenza artificiale|artificial intelligence|machine learning|Daten(?:analyse|verarbeitung|banken?|plattform)?\b|données|\bdati\b|\bdata\b|cloud|biotech\w*|pharma\w*|medizin(?:technik|produkte|ische)\w*|médica(?:l|ux|ments?)|medicament|medtech|diagnosti\w*|therapeuti\w*|thérapeuti\w*|Therapie(?:n|form)?\b|klinische|clinique|clinical|Genom(?:e?\b|ik|isch|sequenz)\w*|génom\w*|genomic\w*|molekular\w*|moléculaire|molecolar\w*|Zell(?:therapie|linien|kultur)\w*|cellulaire|protein\w*|protéin\w*|antikörper|anticorps|\w*sensor(?:en|ik)?\b|capteurs?|robot\w*|drohnen?|drones?|batterie\w*|wasserstoff|hydrogène|quanten\w*|quantique|quantum|photoni\w*|laser\w*|halbleiter\w*|semi-?conduct\w*|forschung und entwicklung|recherche et (?:le )?développement|ricerca e sviluppo|research and development|fintech|blockchain|kryptow\w*|crypto\w*)/i;
// The purpose's opening sentence names the business; the "kann sich beteiligen" boilerplate later doesn't.
export const HOLDING_PURPOSE = /\b(Holding|Halten(?:,| und| von)[^.]{0,40}Beteiligungen|Verwaltung von Beteiligungen|Erwerb[^.]{0,30}Beteiligungen|détention[^.]{0,40}participations|gestion de participations|prise de participations|detenzione[^.]{0,40}partecipazioni|gestione di partecipazioni)/i;
/** The first sentence of a purpose (where the actual business is stated). */
export const firstSentence = (purpose: string) => purpose.split(/(?<=[.;])\s+(?=[A-ZÄÖÜÉÈ])/)[0] ?? purpose;

const SMALL_NOMINAL = 1;
const ESOP_FRACTION = 0.02;

export function evaluateRules(input: RuleInput, config: RuleConfig = defaultRuleConfig()): RuleEvaluation {
  const { event, context, purpose, legalForm } = input;
  const p = event.payload;
  const hits: RuleId[] = [];
  const ageBucket = context.ageBucket;

  // Hard negatives and the pre-filter.
  if (p.restructuringPair) hits.push("restructuring_pair");
  if (p.direction === "reduction") hits.push("capital_reduction");
  let rejectReason: RuleEvaluation["rejectReason"] = null;
  if (legalForm !== LEGAL_FORM.AG) rejectReason = "not_ag";
  else if (p.restructuringPair) rejectReason = "restructuring_pair";
  else if (p.direction === "reduction") rejectReason = "capital_reduction";
  else if (p.direction !== "increase") rejectReason = "not_increase";

  // Positive rules.
  // Across a currency change the two nominal amounts can't be subtracted: amount rules don't apply.
  const increase = p.currencyBefore ? 0 : Number(event.capitalAfter) - Number(event.capitalBefore);
  const nominals = (p.classesAfter ?? []).map((c) => Number(c.nominal));
  const smallNominal = nominals.length > 0 && Math.min(...nominals) <= SMALL_NOMINAL;
  const roundIncrease = increase > 0 && Math.abs(increase % 1000) < 0.005;
  if (smallNominal && increase > 0 && !roundIncrease) hits.push("odd_amount_small_nominal");
  if (ageBucket === "under_2" || ageBucket === "2_to_6") hits.push("young_company");
  if (TECH_PURPOSE.test(purpose)) hits.push("tech_purpose");
  if (context.newPreferredClass === true) hits.push("new_preferred_class");

  // Soft negatives.
  const opening = firstSentence(purpose);
  if (HOLDING_PURPOSE.test(opening) && !TECH_PURPOSE.test(opening) && increase > 0 && Math.abs(increase % 10_000) < 0.005) hits.push("round_amount_holding");
  const sharesBefore = context.sharesBefore;
  // A share split changes counts without issuing: no ESOP reading then.
  if (sharesBefore !== null && event.sharesAfter !== null && event.sharesAfter > sharesBefore && context.newPreferredClass !== true && !p.nominalChanged) {
    if ((event.sharesAfter - sharesBefore) / event.sharesAfter < ESOP_FRACTION) hits.push("esop_sized_increment");
  }
  if (event.contributionType === "set_off") hits.push("set_off_only");
  if (event.contributionType === "in_kind") hits.push("in_kind_only");
  if (event.contributionType === "conditional_capital") hits.push("conditional_capital_issuance");

  const score = hits.reduce((s, id) => s + (config.weights[id] ?? 0), 0);
  const candidate = rejectReason === null;
  return { hits, score, candidate, rejectReason, rulesPositive: candidate && score >= config.threshold, ageBucket };
}

/**
 * Threshold maximizing F1 on dev data (ties → the higher threshold, favouring precision).
 * Dev data only shapes rules; it is never reported as precision or recall.
 */
export function fitThreshold(items: readonly { score: number; positive: boolean; candidate: boolean }[]) {
  const candidates = [...new Set(items.filter((i) => i.candidate).map((i) => i.score))].sort((a, b) => a - b);
  let best = { threshold: Infinity, f1: -1, precision: 0, recall: 0, tp: 0, fp: 0, fn: 0 };
  const positives = items.filter((i) => i.positive).length;
  for (const t of candidates) {
    const predicted = items.filter((i) => i.candidate && i.score >= t);
    const tp = predicted.filter((i) => i.positive).length;
    const fp = predicted.length - tp;
    const fn = positives - tp;
    const precision = predicted.length ? tp / predicted.length : 0;
    const recall = positives ? tp / positives : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    if (f1 > best.f1 || (f1 === best.f1 && t > best.threshold)) best = { threshold: t, f1, precision, recall, tp, fp, fn };
  }
  return best;
}
