// Company history (T5): for every capital-increase candidate, fetch all SHAB HR publications for
// its UID (refetched on every build, eng V5), with the fallback chain SHAB by UID → Zefix's
// dated references → backfill window only. Resumable through `checkpoints`; XML is never
// cached on disk, and logs carry counts only (sealed cohort companies are among the candidates).
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { checkpoints, companySources, publications } from "../../db/schema";
import { parsePublication, publicationUid } from "./parse";
import { fetchPublicationXml, searchByUid } from "./shab";
import { textAt } from "./xml";
import { ZEFIX_FORMATION, zefixPublicationRefs, type ZefixRef } from "./zefix";

export const ZEFIX_UNKNOWN_UID = "UID unknown to Zefix";

export interface HistoryResult {
  listed: number;
  newlyStored: number;
  foreignMentions: number;
  ownPublications: number;
  formationFound: boolean;
  foundedOn: string | null;
  zefixRefs: number;
  /** null, ZEFIX_UNKNOWN_UID, or the message of a failed (retryable) Zefix call. */
  zefixError: string | null;
}

type SourceRow = typeof companySources.$inferInsert;

/** The derived source state; shared by refreshHistory and the network-free recompute. */
export function deriveSourceRow(uid: string, own: { publishedAt: string; subRubric: string }[], formationLegalDate: string | null, zefixRefs: ZefixRef[], zefixError: string | null, foreignMentions: number): SourceRow {
  const earliest = own.map((o) => o.publishedAt).sort()[0] ?? null;
  // Founding date: the HR01's legal date, else the earliest Zefix formation reference.
  const zefixFounding = zefixRefs.filter((r) => r.mutationTypes.includes(ZEFIX_FORMATION)).map((r) => r.date).sort()[0] ?? null;
  return {
    companyUid: uid,
    historyFetchedAt: new Date(),
    shabPublicationCount: own.length,
    earliestShabPublished: earliest,
    // A formation *entry* is stored; a Zefix founding date alone doesn't make the timeline complete.
    formationFound: formationLegalDate !== null,
    foundedOn: formationLegalDate ?? zefixFounding,
    foreignMentions,
    zefixRefs,
    zefixError,
  };
}

async function ownPublications(uid: string) {
  const own = await db().select({ id: publications.id, publishedAt: publications.publishedAt, subRubric: publications.subRubric }).from(publications).where(eq(publications.companyUid, uid));
  const formation = own.filter((o) => o.subRubric === "HR01").sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))[0];
  let formationLegalDate: string | null = null;
  if (formation) {
    const [row] = await db().select({ xml: publications.rawXml }).from(publications).where(eq(publications.id, formation.id));
    // parse emits "formation" only for genuine new registrations (not seat transfers).
    const f = row ? parsePublication(row.xml).events.find((e) => e.type === "formation") : undefined;
    formationLegalDate = f?.type === "formation" ? f.payload.foundedOn : null;
  }
  return { own, formationLegalDate };
}

/** Fetch and store one company's HR publications, then record its source state. */
export async function refreshHistory(uid: string): Promise<HistoryResult> {
  // Only commercial-register entries: bankruptcy or debt-collection notices citing the UID aren't history.
  const metas = (await searchByUid(uid)).filter((m) => m.subRubric.startsWith("HR"));
  const ids = metas.map((m) => m.id);
  const known = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db().select({ id: publications.id, uid: publications.companyUid }).from(publications).where(inArray(publications.id, ids.slice(i, i + 500)));
    for (const r of rows) known.set(r.id, r.uid);
  }
  let foreignMentions = 0;
  const fresh: (typeof publications.$inferInsert)[] = [];
  for (const m of metas) {
    let owner = known.get(m.id);
    if (owner === undefined) {
      const xml = await fetchPublicationXml(m.id, { cache: false });
      owner = publicationUid(xml);
      // Stored whoever it belongs to: raw publications are shared and immutable.
      fresh.push({ id: m.id, publicationNumber: m.publicationNumber, rubric: textAt(xml, ["meta", "rubric"]) ?? "HR", subRubric: m.subRubric, language: m.language, publishedAt: m.publishedAt, companyUid: owner, rawXml: xml });
    }
    if (owner !== uid) foreignMentions++;
  }
  // One write per company instead of one per publication.
  const newlyStored = fresh.length ? (await db().insert(publications).values(fresh).onConflictDoNothing().returning({ id: publications.id })).length : 0;

  const { own, formationLegalDate } = await ownPublications(uid);
  let zefixRefs: ZefixRef[] = [];
  let zefixError: string | null = null;
  if (formationLegalDate === null) {
    try {
      const refs = await zefixPublicationRefs(uid);
      if (refs === null) zefixError = ZEFIX_UNKNOWN_UID;
      else zefixRefs = refs;
    } catch (e) {
      zefixError = (e as Error).message;
    }
  }
  const row = deriveSourceRow(uid, own, formationLegalDate, zefixRefs, zefixError, foreignMentions);
  await db().insert(companySources).values(row).onConflictDoUpdate({ target: companySources.companyUid, set: row });
  return { listed: metas.length, newlyStored, foreignMentions, ownPublications: own.length, formationFound: row.formationFound!, foundedOn: row.foundedOn ?? null, zefixRefs: zefixRefs.length, zefixError };
}

/** Recomputes the derived columns from stored data (no network), e.g. after a logic fix. */
export async function recomputeSources(log = console.log): Promise<number> {
  const rows = await db().select().from(companySources);
  for (const r of rows) {
    const { own, formationLegalDate } = await ownPublications(r.companyUid);
    const next = deriveSourceRow(r.companyUid, own, formationLegalDate, r.zefixRefs, r.zefixError, r.foreignMentions);
    await db()
      .update(companySources)
      .set({ shabPublicationCount: next.shabPublicationCount, earliestShabPublished: next.earliestShabPublished, formationFound: next.formationFound, foundedOn: next.foundedOn })
      .where(eq(companySources.companyUid, r.companyUid));
  }
  log(`recomputed ${rows.length} company_sources rows`);
  return rows.length;
}

export interface HistoryRunStats {
  candidates: number;
  skippedDone: number;
  done: number;
  failed: number;
  newlyStored: number;
  formationFound: number;
  zefixUsed: number;
  /** Zefix had no record of the UID (history limited to SHAB). */
  zefixUnknown: number;
  /** Zefix call failed: marked failed so a resumed run retries the company. */
  zefixFailed: number;
}

export interface HistoryDeps {
  refresh: (uid: string) => Promise<HistoryResult>;
  doneKeys: (job: string) => Promise<Set<string>>;
  mark: (job: string, uid: string, status: "done" | "failed", lastError: string | null) => Promise<unknown>;
}

export const dbHistoryDeps: HistoryDeps = {
  refresh: refreshHistory,
  doneKeys: async (job) =>
    new Set((await db().select({ key: checkpoints.itemKey }).from(checkpoints).where(and(eq(checkpoints.job, job), eq(checkpoints.status, "done")))).map((r) => r.key)),
  mark: (job, uid, status, lastError) =>
    db()
      .insert(checkpoints)
      .values({ job, itemKey: uid, status, attempts: 1, lastError })
      .onConflictDoUpdate({ target: [checkpoints.job, checkpoints.itemKey], set: { status, lastError, attempts: sql`${checkpoints.attempts} + 1`, updatedAt: sql`now()` } }),
};

/** Runs refreshHistory over `uids`, resumable per `runKey`: companies done in this run are skipped. */
export async function runHistory(
  uids: string[],
  runKey: string,
  opts: { concurrency?: number; log?: (s: string) => void; stop?: () => boolean } = {},
  deps: HistoryDeps = dbHistoryDeps,
): Promise<HistoryRunStats> {
  const log = opts.log ?? console.log;
  const job = `history:${runKey}`;
  const done = await deps.doneKeys(job);
  const todo = uids.filter((u) => !done.has(u));
  const stats: HistoryRunStats = { candidates: uids.length, skippedDone: uids.length - todo.length, done: 0, failed: 0, newlyStored: 0, formationFound: 0, zefixUsed: 0, zefixUnknown: 0, zefixFailed: 0 };
  log(`${uids.length} candidates, ${stats.skippedDone} already done in run ${runKey}, ${todo.length} to fetch`);
  let next = 0;
  await Promise.all(
    Array.from({ length: opts.concurrency ?? 4 }, async () => {
      while (next < todo.length && !opts.stop?.()) {
        const uid = todo[next++]!;
        let result: HistoryResult | null = null;
        let failure: string | null = null;
        try {
          result = await deps.refresh(uid);
        } catch (e) {
          failure = (e as Error).message;
        }
        const zefixFailure = result?.zefixError && result.zefixError !== ZEFIX_UNKNOWN_UID ? `zefix: ${result.zefixError}` : null;
        const error = failure ?? zefixFailure;
        // Counted once, after the checkpoint is written; a failed write leaves the item to retry.
        await deps.mark(job, uid, error ? "failed" : "done", error ?? result?.zefixError ?? null);
        if (error) {
          stats.failed++;
          if (zefixFailure) stats.zefixFailed++;
          console.error(`[history] item failed (${stats.failed} so far): ${error.slice(0, 160)}`);
        } else {
          stats.done++;
          stats.newlyStored += result!.newlyStored;
          if (result!.formationFound) stats.formationFound++;
          if (result!.zefixRefs > 0) stats.zefixUsed++;
          if (result!.zefixError === ZEFIX_UNKNOWN_UID) stats.zefixUnknown++;
        }
        if ((stats.done + stats.failed) % 100 === 0) log(`history ${stats.done + stats.failed}/${todo.length} (${stats.failed} failed)`);
      }
    }),
  );
  return stats;
}
