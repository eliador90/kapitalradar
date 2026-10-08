// Server-side data readers (T10, T14, T15, T17). Each reads one release, resolved once per
// request by the caller, through the read-only database role. Rows are filtered by release_id and published_at <= asOf (db/predicates).
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { visibleAt } from "../../db/predicates";
import { assessments, classifications, companyNames, companySources, confirmations, currentRelease, events, publications, releases } from "../../db/schema";
import { coverageFromSources, coverageLine } from "../domain/coverage";
import { isCapitalIncrease } from "../domain/events";
import { shareIssuance, type Issuance, type IssuancePayload } from "../domain/issuance";
import type { EventMatch, ReleaseConfig, Tier } from "../domain/schemas";
import { deriveStatus, isConfirmed, type ConfirmationLink, type Status } from "../domain/status";
import { correctedAt, nameAt, visibleEvents } from "./asof-view";

export interface ReleaseMeta {
  id: string;
  snapshotDate: string;
  backfillStart: string;
  config: ReleaseConfig;
  evalResult: unknown;
}

/** The live release (callers wrap this in React cache() so one request sees one release). */
export async function readCurrentRelease(): Promise<ReleaseMeta | null> {
  const [row] = await db()
    .select({ id: releases.id, snapshotDate: releases.snapshotDate, backfillStart: releases.backfillStart, config: releases.config, evalResult: releases.evalResult })
    .from(currentRelease)
    .innerJoin(releases, eq(releases.id, currentRelease.releaseId))
    .where(eq(currentRelease.id, 1));
  return row ?? null;
}

export interface FeedRow {
  eventId: string;
  companyUid: string;
  companyName: string;
  canton: string | null;
  purpose: string;
  publicationNumber: string;
  publicationId: string;
  publishedAt: string;
  /** Publication language (de/fr/it) for the lang attribute on names and purpose (DS3). */
  language: string;
  currency: string | null;
  capitalBefore: string | null;
  capitalAfter: string | null;
  sharesBefore: number | null;
  sharesAfter: number | null;
  issuance: Issuance;
  status: Status;
  tier: Tier | null;
  /** Claude's score; null when the step wasn't sent to the classifier. Not a probability. */
  score: number | null;
  announcedRound: { url: string; statedAmount: string | null; statedCurrency: string | null } | null;
}

/** One day of the timeline: assessed capital increases published that day, by tier. */
export interface DayCount {
  d: string;
  likely: number;
  undecided: number;
  increased: number;
}

/**
 * Daily counts for the timeline, from the backfill start to asOf and never beyond: later days
 * are not sent to the browser at all, so dragging back in time can't reveal the future (A11/A12).
 * Cancelled entries are not subtracted here; the feed itself applies cancellations.
 */
export async function readDailySeries(release: ReleaseMeta, asOf: string): Promise<DayCount[]> {
  const rows = (
    await db().execute(sql`
      select e.published_at::text as d, a.tier, count(*)::int as n
      from assessments a join events e on e.id = a.event_id
      where a.release_id = ${release.id} and e.published_at >= ${release.backfillStart} and e.published_at <= ${asOf}
      group by 1, 2`)
  ).rows as { d: string; tier: Tier; n: number }[];
  const byDay = new Map<string, DayCount>();
  for (const r of rows) {
    const day = byDay.get(r.d) ?? { d: r.d, likely: 0, undecided: 0, increased: 0 };
    if (r.tier === "likely_financing") day.likely += r.n;
    else if (r.tier === "abstain") day.undecided += r.n;
    else day.increased += r.n;
    byDay.set(r.d, day);
  }
  return [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d));
}

type EventRow = typeof events.$inferSelect & { publicationNumber: string; language: string };
type ConfirmationRow = typeof confirmations.$inferSelect;

const isIncrease = (e: EventRow) => e.type === "capital_change" && isCapitalIncrease(e.payload);
const linkOf = (c: ConfirmationRow): ConfirmationLink => ({ eventMatch: c.eventMatch, matchConfidence: c.matchConfidence, reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null });
const issuanceOf = (e: EventRow) => shareIssuance({ ...(e.payload as IssuancePayload), sharesBefore: e.sharesBefore, sharesAfter: e.sharesAfter });

/** Capital increases published in [start, end] (end already capped at asOf), newest first. */
export async function readFeedWeek(release: ReleaseMeta, asOf: string, start: string, end: string): Promise<FeedRow[]> {
  const r = release.id;
  // A cancellation is published on or after the entry it cancels, so start bounds both queries.
  const rows = await db()
    .select({ e: events, pub: { number: publications.publicationNumber, language: publications.language } })
    .from(events)
    .innerJoin(publications, eq(publications.id, events.publicationId))
    .where(and(visibleAt(events, r, asOf), gte(events.publishedAt, start), or(lte(events.publishedAt, end), eq(events.type, "cancellation"))));
  const all = rows.map(({ e, pub }) => ({ ...e, publicationNumber: pub.number, language: pub.language }));
  const visible = visibleEvents(all, asOf).filter((e) => e.publishedAt <= end && isIncrease(e));
  if (!visible.length) return [];
  const ids = visible.map((e) => e.id);
  const uids = [...new Set(visible.map((e) => e.companyUid))];
  const [assess, names, confs] = await Promise.all([
    db()
      .select({ a: assessments, score: classifications.score })
      .from(assessments)
      .leftJoin(classifications, eq(classifications.id, assessments.classificationId))
      .where(and(eq(assessments.releaseId, r), inArray(assessments.eventId, ids))),
    db().select().from(companyNames).where(and(visibleAt(companyNames, r, asOf), inArray(companyNames.companyUid, uids))),
    db().select().from(confirmations).where(and(visibleAt(confirmations, r, asOf), inArray(confirmations.matchedEventId, ids))),
  ]);
  return visible
    .map((e) => {
      const found = assess.find((x) => x.a.eventId === e.id);
      const a = found?.a;
      const cs = confs.filter((c) => c.matchedEventId === e.id);
      const accepted = cs.find((c) => isConfirmed(linkOf(c)));
      const payload = e.payload as { canton?: string | null; purpose?: string };
      return {
        eventId: e.id,
        companyUid: e.companyUid,
        companyName: nameAt(names.filter((n) => n.companyUid === e.companyUid), asOf) ?? e.companyUid,
        canton: payload.canton ?? null,
        purpose: payload.purpose ?? "",
        publicationNumber: e.publicationNumber,
        publicationId: e.publicationId,
        publishedAt: e.publishedAt,
        language: e.language,
        currency: e.currency,
        capitalBefore: e.capitalBefore,
        capitalAfter: e.capitalAfter,
        sharesBefore: e.sharesBefore,
        sharesAfter: e.sharesAfter,
        issuance: issuanceOf(e),
        tier: a?.tier ?? null,
        score: found?.score ?? null,
        status: deriveStatus(a?.tier ?? null, cs.map(linkOf)),
        announcedRound: accepted ? { url: accepted.sourceUrl, statedAmount: accepted.statedAmount, statedCurrency: accepted.statedCurrency } : null,
      };
    })
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt) || y.publicationNumber.localeCompare(x.publicationNumber));
}

export interface Evidence {
  ruleHits: string[];
  rulesScore: number;
  rejectReason: string | null;
  /** Claude's score; null when the candidate was not classified (pre-filter reject) or errored. */
  score: number | null;
}

export interface CompanyRecord {
  uid: string;
  name: string;
  /** Language of the latest visible publication (lang attribute on the name). */
  language: string | null;
  legalForm: string | null;
  canton: string | null;
  coverage: string;
  foundedOn: string | null;
  entries: {
    eventId: string;
    type: string;
    publishedAt: string;
    legalDate: string;
    publicationNumber: string;
    publicationId: string;
    payload: unknown;
    capitalBefore: string | null;
    capitalAfter: string | null;
    sharesBefore: number | null;
    sharesAfter: number | null;
    contributionType: string | null;
    issuance: Issuance | null;
    /** Capital increases only; other steps carry no tier. */
    status: Status | null;
    evidence: Evidence | null;
    language: string;
    correctedOn: string | null;
    corrects: string | null;
  }[];
  /** `eventMatch` is null while the matched entry is not yet published at asOf (never leak it). */
  confirmations: { publishedAt: string; sourceUrl: string; eventMatch: EventMatch | null; matchConfidence: string; reviewed: boolean }[];
}

/**
 * One company's record at asOf, or null. The release holds only companies with a capital
 * increase in the backfill window, so a page exists only once such an increase is published by
 * asOf: unknown and not-yet-raising UIDs get the same null, and a rewound page never reveals
 * that a company raises later (eng delta A11).
 */
export async function readCompany(release: ReleaseMeta, uid: string, asOf: string): Promise<CompanyRecord | null> {
  const r = release.id;
  const rows = await db()
    .select({ e: events, pub: { number: publications.publicationNumber, language: publications.language } })
    .from(events)
    .innerJoin(publications, eq(publications.id, events.publicationId))
    .where(and(visibleAt(events, r, asOf), eq(events.companyUid, uid)));
  const all = rows.map(({ e, pub }) => ({ ...e, publicationNumber: pub.number, language: pub.language }));
  const visible = visibleEvents(all, asOf);
  if (!visible.some((e) => isIncrease(e) && e.publishedAt >= release.backfillStart)) return null;
  const names = await db().select().from(companyNames).where(and(visibleAt(companyNames, r, asOf), eq(companyNames.companyUid, uid)));
  const name = nameAt(names, asOf);
  if (!name) return null;
  const ids = visible.map((e) => e.id);
  const visibleIds = new Set(ids);
  const [assess, confs, [src]] = await Promise.all([
    db()
      .select({ a: assessments, score: classifications.score })
      .from(assessments)
      .leftJoin(classifications, eq(classifications.id, assessments.classificationId))
      .where(and(eq(assessments.releaseId, r), inArray(assessments.eventId, ids))),
    db().select().from(confirmations).where(and(visibleAt(confirmations, r, asOf), eq(confirmations.companyUid, uid))),
    db().select().from(companySources).where(eq(companySources.companyUid, uid)),
  ]);
  const corrected = correctedAt(all, asOf);
  const foundedOn = src?.foundedOn && src.foundedOn <= asOf ? src.foundedOn : null;
  const coverage = coverageLine(
    src
      ? coverageFromSources({
          ...src,
          // Every coverage fact is capped at asOf, like the summary (one rewind rule).
          foundedOn,
          formationFound: src.formationFound && foundedOn !== null,
          earliestShabPublished: src.earliestShabPublished && src.earliestShabPublished <= asOf ? src.earliestShabPublished : null,
          zefixRefs: src.zefixRefs.filter((z) => z.date <= asOf),
        })
      : { formationFound: false, foundedOn: null, earliestShabPublished: null, earliestZefixRef: null, historyLookupFailed: true },
    release.backfillStart,
  );
  const sorted = visible.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.seq - b.seq);
  const latest = <K extends "legalForm" | "canton">(key: K) =>
    [...sorted].reverse().map((e) => (e.payload as Partial<Record<K, string | null>>)[key]).find((v): v is string => !!v) ?? null;
  return {
    uid,
    name,
    language: sorted.at(-1)?.language ?? null,
    legalForm: latest("legalForm"),
    canton: latest("canton"),
    coverage,
    foundedOn,
    entries: sorted.map((e) => {
      const found = assess.find((x) => x.a.eventId === e.id);
      const a = found?.a;
      const increase = isIncrease(e);
      return {
        eventId: e.id,
        type: e.type,
        publishedAt: e.publishedAt,
        legalDate: e.legalDate,
        publicationNumber: e.publicationNumber,
        publicationId: e.publicationId,
        payload: e.payload,
        capitalBefore: e.capitalBefore,
        capitalAfter: e.capitalAfter,
        sharesBefore: e.sharesBefore,
        sharesAfter: e.sharesAfter,
        contributionType: e.contributionType,
        issuance: e.type === "capital_change" ? issuanceOf(e) : null,
        status: increase ? deriveStatus(a?.tier ?? null, confs.filter((c) => c.matchedEventId === e.id).map(linkOf)) : null,
        evidence: increase && a ? { ruleHits: a.ruleHits, rulesScore: a.rulesScore, rejectReason: a.rejectReason, score: found?.score ?? null } : null,
        language: e.language,
        correctedOn: corrected.get(e.publicationNumber) ?? null,
        corrects: e.correctsPublicationNumber,
      };
    }),
    confirmations: confs.map((c) => ({
      publishedAt: c.publishedAt,
      sourceUrl: c.sourceUrl,
      eventMatch: c.matchedEventId && !visibleIds.has(c.matchedEventId) ? null : c.eventMatch,
      matchConfidence: c.matchConfidence,
      reviewed: c.reviewedAt !== null,
    })),
  };
}
