// Release build (T8, T17): derive every release-scoped row from the immutable publications,
// check the gates, then flip current_release in one transaction (eng V3). A failed build marks
// its own release failed and never touches the pointer, so visitors keep the live release.
import { randomUUID } from "node:crypto";
import { addDays } from "../domain/dates";
import { isCapitalIncrease } from "../domain/events";
import { isGazetteDay } from "../domain/holidays";
import type { ReleaseConfig, Tier } from "../domain/schemas";
import type { CompanyBundle } from "./candidates";
import { tierFor, type StoredClassification } from "./classify";
import { maskInlinePersons, personDataHits, type ClauseKind } from "./clauses";

export const GATE_MAX_RATE = 0.05; // plan: parse-failure and classifier-error rate

export interface EventRow {
  id: string;
  publicationId: string;
  seq: number;
  companyUid: string;
  type: string;
  publishedAt: string;
  legalDate: string;
  currency: string | null;
  capitalBefore: string | null;
  capitalAfter: string | null;
  sharesBefore: number | null;
  sharesAfter: number | null;
  contributionType: string | null;
  payload: unknown;
  spans: { start: number; end: number; kind: string }[];
  correctsPublicationNumber: string | null;
  cancelsPublicationNumber: string | null;
}
export interface NameRow { companyUid: string; name: string; publishedAt: string; publicationId: string }
export interface AssessmentRow {
  eventId: string;
  tier: Tier;
  ruleHits: string[];
  rulesScore: number;
  rulesPositive: boolean;
  rejectReason: string | null;
  classificationInputHash: string | null;
}
export interface ConfirmationRow {
  companyUid: string;
  sourceUrl: string;
  publishedAt: string;
  statedAmount: string | null;
  statedCurrency: string | null;
  stage: string | null;
  matchMethod: string;
  matchConfidence: "high" | "low";
  eventMatch: "accepted" | "rejected" | "uncertain";
  reviewedAt: string | null;
  /** The matched publication; resolved to this release's event id at build time. */
  matchedPublicationId: string | null;
}

export interface ReleaseRepo {
  currentReleaseId(): Promise<string | null>;
  createRelease(r: { id: string; snapshotDate: string; backfillStart: string; config: ReleaseConfig }): Promise<void>;
  writeEvents(releaseId: string, rows: EventRow[]): Promise<void>;
  writeCompanyNames(releaseId: string, rows: NameRow[]): Promise<void>;
  writeAssessments(releaseId: string, rows: AssessmentRow[]): Promise<void>;
  writeConfirmations(releaseId: string, rows: (Omit<ConfirmationRow, "matchedPublicationId"> & { matchedEventId: string | null })[]): Promise<void>;
  setEvalResult(releaseId: string, evalResult: unknown): Promise<void>;
  markFailed(releaseId: string, reason: string): Promise<void>;
  /** One transaction: release status ready + activated_at, and current_release → releaseId. */
  activate(releaseId: string): Promise<void>;
}

export interface GateReport {
  passed: boolean;
  failures: string[];
  parseFailureRate: number;
  classifierErrorRate: number;
  missingGazetteDays: string[];
  evidenceViolations: number;
  evalPresent: boolean;
}

const CAPITAL_SPAN_KINDS: ClauseKind[] = ["capital", "shares", "contribution", "band", "conversion"];
/** Longest excerpt shown; the full entry is one click away on the SHAB. */
export const EXCERPT_MAX_CHARS = 700;
/**
 * Clauses quoted on the public site. Contribution clauses are left out: they name who contributed
 * or set off claims (often natural persons); the contribution type is stated in our own words.
 */
export const EXCERPT_KINDS: ClauseKind[] = ["capital", "shares", "band", "conversion"];
// Anything name-like that survives masking withholds the whole excerpt (public site, so strict):
// "par Surname Firstname", "von Dr. X Y", or a contributor's domicile "…, in Wattens (AT)".
const NAME_LIKE =
  /\b(?:von|de|par|durch|an|à|da|di|dal|della|du)\s+(?:Herrn?|Frau|Dr\.?|M\.|Mme|Monsieur|Madame)?\s*[A-ZÄÖÜÉÈ][a-zäöüéèàç]+(?:[- ][A-ZÄÖÜÉÈ][a-zäöüéèàç]+){1,2}\b(?!\s+(?:AG|SA|GmbH|Sàrl|Ltd|Inc|S\.A\.|Holding|Group|Capital|Partners))|,\s+(?:in|à|a)\s+[A-ZÄÖÜ][a-zäöü]+\s*\([A-Z]{2}\)/u;

/**
 * The gazette passage behind a capital step, for the company page (SHAB terms of use §3.3 allow
 * reuse with attribution). Built from the step's capital, share, band and conversion clauses with
 * inline person names replaced; null (withheld) when anything person-like survives the masking.
 */
export function excerptOf(text: string, clauses: readonly { start: number; end: number; kind: ClauseKind }[]): string | null {
  const joined = clauses
    .filter((c) => EXCERPT_KINDS.includes(c.kind))
    .sort((a, b) => a.start - b.start)
    .map((s) => text.slice(s.start, s.end).trim())
    .filter(Boolean)
    .join(" ");
  if (!joined) return null;
  const masked = maskInlinePersons(joined).replace(/<PERSON_\d+>/g, "[name removed]");
  if (personDataHits(masked).length || NAME_LIKE.test(masked)) return null;
  return masked.length > EXCERPT_MAX_CHARS ? `${masked.slice(0, EXCERPT_MAX_CHARS).replace(/\s+\S*$/, "")} …` : masked;
}

const SPAN_KINDS: Record<string, ClauseKind[]> = {
  capital_change: CAPITAL_SPAN_KINDS,
  conversion_to_ag: ["conversion", "capital", "shares"],
  capital_band: ["band"],
  formation: ["purpose", "capital", "shares"],
  name_change: ["name"],
  cancellation: ["correction", "other"],
};

export interface BuildInput {
  releaseId: string;
  snapshotDate: string;
  backfillStart: string;
  config: ReleaseConfig;
  companies: CompanyBundle[];
  /** Classification by input hash (model + prompt version fixed by the config). */
  classification: (inputHash: string) => StoredClassification | null;
  confirmations: ConfirmationRow[];
  /** Days in the window with at least one stored HR02 (from publications). */
  daysWithEntries: Set<string>;
  /** Release eval artifact (T9); activation requires it. */
  evalResult: unknown | null;
}

export interface BuildResult {
  releaseId: string;
  activated: boolean;
  gates: GateReport;
  counts: { companies: number; events: number; assessments: number; candidates: number; names: number; confirmations: number };
}

export function deriveRows(input: Pick<BuildInput, "companies" | "classification" | "config" | "snapshotDate" | "backfillStart">) {
  const events: EventRow[] = [];
  const names: NameRow[] = [];
  const assessments: AssessmentRow[] = [];
  const eventIdByPublication = new Map<string, string>();
  let candidates = 0;
  let classifierErrors = 0;
  let parseFailures = 0;
  let publications = 0;
  let evidenceViolations = 0;
  for (const company of input.companies) {
    parseFailures += company.parseFailures.length;
    publications += company.publications.length + company.parseFailures.length;
    const byPub = new Map(company.capitalChanges.map((c) => [c.publication.id, c]));
    for (const p of company.publications) {
      if (p.publishedAt > input.snapshotDate) continue; // the release covers publications up to the snapshot
      names.push({ companyUid: company.uid, name: p.companyName, publishedAt: p.publishedAt, publicationId: p.id });
      p.events.forEach((e, seq) => {
        const id = randomUUID();
        const spans = p.clauses.filter((c) => (SPAN_KINDS[e.type] ?? []).includes(c.kind)).map((c) => ({ start: c.start, end: c.end, kind: c.kind }));
        for (const s of spans) if (s.start < 0 || s.end > p.text.length || s.start >= s.end) evidenceViolations++;
        const capital = e.type === "capital_change" ? e : null;
        events.push({
          id,
          publicationId: p.id,
          seq,
          companyUid: company.uid,
          type: e.type,
          publishedAt: p.publishedAt,
          legalDate: p.legalDate,
          currency: capital?.currency ?? null,
          capitalBefore: capital?.capitalBefore ?? null,
          capitalAfter: capital?.capitalAfter ?? null,
          sharesBefore: capital ? (byPub.get(p.id)?.context.sharesBefore ?? capital.sharesBefore) : null,
          sharesAfter: capital?.sharesAfter ?? null,
          contributionType: capital?.contributionType ?? null,
          // Company facts as published in this entry (as-of correct for the event's own date).
          payload: capital
            ? { ...capital.payload, context: byPub.get(p.id)?.context ?? null, canton: p.canton, purpose: p.purpose, legalForm: p.legalForm, excerpt: excerptOf(p.text, p.clauses) }
            : e.payload,
          spans,
          correctsPublicationNumber: p.correctsPublicationNumber,
          cancelsPublicationNumber: e.type === "cancellation" ? e.payload.cancelsPublicationNumber : null,
        });
        if (capital) eventIdByPublication.set(p.id, id);
        const cand = capital ? byPub.get(p.id) : undefined;
        // Only capital increases in the backfill window are assessed; earlier history is context
        // ("not assessed", plan "Tier") and reductions carry no tier.
        if (!cand || p.publishedAt < input.backfillStart || !isCapitalIncrease(cand.event.payload)) return;
        let tier: Tier = "capital_increased";
        let hash: string | null = null;
        if (cand.rules.candidate) {
          candidates++;
          hash = cand.inputHash;
          const c = input.classification(cand.inputHash);
          if (!c || c.error) classifierErrors++;
          tier = !c || c.error ? "abstain" : tierFor(c.output?.score ?? null, input.config.tau, input.config.tauLow, c.refusal);
        }
        assessments.push({ eventId: id, tier, ruleHits: cand.rules.hits, rulesScore: cand.rules.score, rulesPositive: cand.rules.rulesPositive, rejectReason: cand.rules.rejectReason, classificationInputHash: hash });
      });
    }
  }
  return { events, names, assessments, eventIdByPublication, candidates, classifierErrors, parseFailures, publications, evidenceViolations };
}

export function missingGazetteDays(daysWithEntries: Set<string>, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isGazetteDay(d) && !daysWithEntries.has(d)) out.push(d);
  return out;
}

export async function buildRelease(input: BuildInput, repo: ReleaseRepo, log = console.log): Promise<BuildResult> {
  const derived = deriveRows(input);
  const gates: GateReport = {
    passed: false,
    failures: [],
    parseFailureRate: derived.publications ? derived.parseFailures / derived.publications : 0,
    classifierErrorRate: derived.candidates ? derived.classifierErrors / derived.candidates : 0,
    missingGazetteDays: missingGazetteDays(input.daysWithEntries, input.backfillStart, input.snapshotDate),
    evidenceViolations: derived.evidenceViolations,
    evalPresent: input.evalResult !== null && input.evalResult !== undefined,
  };
  if (gates.parseFailureRate > GATE_MAX_RATE) gates.failures.push(`parse failures ${(gates.parseFailureRate * 100).toFixed(1)}% > 5%`);
  if (gates.classifierErrorRate > GATE_MAX_RATE) gates.failures.push(`classifier errors/unclassified ${(gates.classifierErrorRate * 100).toFixed(1)}% > 5%`);
  if (gates.missingGazetteDays.length) gates.failures.push(`gazette days with zero HR02 entries: ${gates.missingGazetteDays.join(", ")}`);
  if (gates.evidenceViolations) gates.failures.push(`${gates.evidenceViolations} evidence spans outside their publication text`);
  if (!gates.evalPresent) gates.failures.push("no eval results (methodology never ships without them)");
  gates.passed = gates.failures.length === 0;

  const counts = {
    companies: input.companies.length,
    events: derived.events.length,
    assessments: derived.assessments.length,
    candidates: derived.candidates,
    names: derived.names.length,
    confirmations: input.confirmations.length,
  };
  await repo.createRelease({ id: input.releaseId, snapshotDate: input.snapshotDate, backfillStart: input.backfillStart, config: input.config });
  try {
    await repo.writeEvents(input.releaseId, derived.events);
    await repo.writeCompanyNames(input.releaseId, derived.names);
    await repo.writeAssessments(input.releaseId, derived.assessments);
    await repo.writeConfirmations(
      input.releaseId,
      input.confirmations.map(({ matchedPublicationId, ...c }) => ({ ...c, matchedEventId: matchedPublicationId ? (derived.eventIdByPublication.get(matchedPublicationId) ?? null) : null })),
    );
    if (gates.evalPresent) await repo.setEvalResult(input.releaseId, input.evalResult);
  } catch (e) {
    await repo.markFailed(input.releaseId, `write failed: ${(e as Error).message}`);
    throw e;
  }
  if (!gates.passed) {
    await repo.markFailed(input.releaseId, gates.failures.join("; "));
    log(`release ${input.releaseId} FAILED its gates: ${gates.failures.join("; ")}`);
    return { releaseId: input.releaseId, activated: false, gates, counts };
  }
  await repo.activate(input.releaseId);
  log(`release ${input.releaseId} activated`);
  return { releaseId: input.releaseId, activated: true, gates, counts };
}

/** Rollback = activate the previous release (plan: "re-points to the previous release"). */
export const rollback = (repo: ReleaseRepo, toReleaseId: string) => repo.activate(toReleaseId);

/**
 * Releases to delete so the database stays small (Neon free tier): keep the current release and
 * the newest `keep - 1` other ready releases (rollback targets); every older or failed build goes.
 * Never returns the current release.
 */
export function releasesToPrune(all: readonly { id: string; status: string }[], currentId: string | null, keep = 2): string[] {
  const num = (id: string) => Number(id.slice(1));
  const ready = all.filter((r) => r.status === "ready" && r.id !== currentId).sort((a, b) => num(b.id) - num(a.id));
  const kept = new Set([...(currentId ? [currentId] : []), ...ready.slice(0, Math.max(0, keep - 1)).map((r) => r.id)]);
  return all.filter((r) => !kept.has(r.id) && r.status !== "building").map((r) => r.id).sort((a, b) => num(a) - num(b));
}
