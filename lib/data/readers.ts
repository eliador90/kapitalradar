// Server-side data readers (T10, T14, T15, T17). Every reader checks the preview gate first
// (eng delta V9: the proxy is not a security boundary) and reads one release, resolved once per
// request by the caller. Rows are filtered by release_id and published_at <= asOf (db/predicates).
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../db/client";
import { visibleAt } from "../../db/predicates";
import { assessments, companyNames, companySources, confirmations, currentRelease, events, publications, releases } from "../../db/schema";
import { coverageFromSources, coverageLine } from "../domain/coverage";
import type { ReleaseConfig, Tier } from "../domain/schemas";
import { deriveStatus, type ConfirmationLink, type Status } from "../domain/status";
import { assertPreviewAccess } from "../preview-gate";
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
  await assertPreviewAccess();
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
  currency: string | null;
  capitalBefore: string | null;
  capitalAfter: string | null;
  sharesBefore: number | null;
  sharesAfter: number | null;
  status: Status;
  tier: Tier | null;
  announcedRound: { url: string; statedAmount: string | null; statedCurrency: string | null } | null;
}

/** Capital increases published in [start, end] (end already capped at asOf), newest first. */
export async function readFeedWeek(release: ReleaseMeta, asOf: string, start: string, end: string): Promise<FeedRow[]> {
  await assertPreviewAccess();
  const r = release.id;
  const rows = await db()
    .select({ e: events, pub: { number: publications.publicationNumber } })
    .from(events)
    .innerJoin(publications, eq(publications.id, events.publicationId))
    .where(and(visibleAt(events, r, asOf), gte(events.publishedAt, start), lte(events.publishedAt, end)));
  const cancellations = await db()
    .select({ e: events, pub: { number: publications.publicationNumber } })
    .from(events)
    .innerJoin(publications, eq(publications.id, events.publicationId))
    .where(and(visibleAt(events, r, asOf), eq(events.type, "cancellation")));
  const all = [...rows, ...cancellations].map(({ e, pub }) => ({ ...e, publicationNumber: pub.number }));
  const visible = visibleEvents(all, asOf).filter((e) => e.type === "capital_change" && Number(e.capitalAfter) > Number(e.capitalBefore));
  if (!visible.length) return [];
  const ids = visible.map((e) => e.id);
  const uids = [...new Set(visible.map((e) => e.companyUid))];
  const [assess, names, confs] = await Promise.all([
    db().select().from(assessments).where(and(eq(assessments.releaseId, r), inArray(assessments.eventId, ids))),
    db().select().from(companyNames).where(and(visibleAt(companyNames, r, asOf), inArray(companyNames.companyUid, uids))),
    db().select().from(confirmations).where(and(visibleAt(confirmations, r, asOf), inArray(confirmations.matchedEventId, ids))),
  ]);
  return visible
    .map((e) => {
      const a = assess.find((x) => x.eventId === e.id);
      const cs = confs.filter((c) => c.matchedEventId === e.id);
      const links: ConfirmationLink[] = cs.map((c) => ({ eventMatch: c.eventMatch, matchConfidence: c.matchConfidence, reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null }));
      const accepted = cs.find((c) => c.eventMatch === "accepted" && (c.matchConfidence === "high" || c.reviewedAt));
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
        currency: e.currency,
        capitalBefore: e.capitalBefore,
        capitalAfter: e.capitalAfter,
        sharesBefore: e.sharesBefore,
        sharesAfter: e.sharesAfter,
        tier: a?.tier ?? null,
        status: deriveStatus(a?.tier ?? null, links),
        announcedRound: accepted ? { url: accepted.sourceUrl, statedAmount: accepted.statedAmount, statedCurrency: accepted.statedCurrency } : null,
      };
    })
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt) || y.publicationNumber.localeCompare(x.publicationNumber));
}

export interface CompanyRecord {
  uid: string;
  name: string;
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
    status: Status | null;
    correctedOn: string | null;
    corrects: string | null;
  }[];
  confirmations: { publishedAt: string; sourceUrl: string; eventMatch: string; matchConfidence: string; reviewed: boolean }[];
}

/**
 * One company's record at asOf, or null when nothing of it is published by asOf. Unknown and
 * not-yet-published UIDs get the same null, so a rewound page never reveals later existence (A11).
 */
export async function readCompany(release: ReleaseMeta, uid: string, asOf: string): Promise<CompanyRecord | null> {
  await assertPreviewAccess();
  const r = release.id;
  const rows = await db()
    .select({ e: events, pub: { number: publications.publicationNumber } })
    .from(events)
    .innerJoin(publications, eq(publications.id, events.publicationId))
    .where(and(visibleAt(events, r, asOf), eq(events.companyUid, uid)));
  const all = rows.map(({ e, pub }) => ({ ...e, publicationNumber: pub.number }));
  const visible = visibleEvents(all, asOf);
  const names = await db().select().from(companyNames).where(and(visibleAt(companyNames, r, asOf), eq(companyNames.companyUid, uid)));
  const name = nameAt(names, asOf);
  if (!name) return null;
  const ids = visible.map((e) => e.id);
  const [assess, confs, [src]] = await Promise.all([
    ids.length ? db().select().from(assessments).where(and(eq(assessments.releaseId, r), inArray(assessments.eventId, ids))) : Promise.resolve([]),
    db().select().from(confirmations).where(and(visibleAt(confirmations, r, asOf), eq(confirmations.companyUid, uid))),
    db().select().from(companySources).where(eq(companySources.companyUid, uid)),
  ]);
  const corrected = correctedAt(all, asOf);
  const foundedOn = src?.foundedOn && src.foundedOn <= asOf ? src.foundedOn : null;
  const coverage = src ? coverageLine(coverageFromSources({ ...src, zefixRefs: src.zefixRefs.filter((z) => z.date <= asOf) }), release.backfillStart) : coverageLine({ formationFound: false, foundedOn: null, earliestShabPublished: null, earliestZefixRef: null, historyLookupFailed: true }, release.backfillStart);
  return {
    uid,
    name,
    coverage,
    foundedOn,
    entries: visible
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.seq - b.seq)
      .map((e) => {
        const a = assess.find((x) => x.eventId === e.id);
        const links = confs.filter((c) => c.matchedEventId === e.id).map((c) => ({ eventMatch: c.eventMatch, matchConfidence: c.matchConfidence, reviewedAt: c.reviewedAt ? c.reviewedAt.toISOString() : null }));
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
          status: e.type === "capital_change" ? deriveStatus(a?.tier ?? null, links) : null,
          correctedOn: corrected.get(e.publicationNumber) ?? null,
          corrects: e.correctsPublicationNumber,
        };
      }),
    confirmations: confs.map((c) => ({ publishedAt: c.publishedAt, sourceUrl: c.sourceUrl, eventMatch: c.eventMatch, matchConfidence: c.matchConfidence, reviewed: c.reviewedAt !== null })),
  };
}
