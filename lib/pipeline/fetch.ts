// Ingest (T4): list HR02 publications for a window, fetch the XML of those not stored yet, and
// write them to `publications` (immutable, shared by all releases). Resumable: rerunning skips
// stored ids. XML is never cached on disk here, so sealed cohort entries stay out of .data/.
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { ingestRuns, publications } from "../../db/schema";
import { addDays, isoWeekday, minDate } from "../domain/dates";
import { parsePublication, publicationUid, PARSER_VERSION } from "./parse";
import { fetchPublicationXml, searchAll, type PublicationMeta } from "./shab";

/** Plan "Ingest": DE + FR capital wording, capital bands and conversions. IT is a drop item. */
export const INGEST_QUERIES = [
  { keyword: "Aktienkapital", language: "de" },
  { keyword: "capital-actions", language: "fr" },
  { keyword: "Kapitalband", language: "de" },
  { keyword: "marge de fluctuation", language: "fr" },
  { keyword: "Umwandlung", language: "de" },
  { keyword: "transformée", language: "fr" },
] as const;

/** Plan: a release is not published above this parse-failure rate. */
export const MAX_PARSE_FAILURE_RATE = 0.05;
const CHUNK_DAYS = 31;
const CONCURRENCY = 4;
const INSERT_BATCH = 25;

export interface IngestStats {
  listed: number;
  alreadyStored: number;
  fetched: number;
  stored: number;
  parseFailures: number;
  fetchFailures: number;
  /** Rows the database skipped on conflict (logged in the run's errors). */
  skippedOnConflict: number;
  byQuery: Record<string, number>;
  /** Weekdays with zero listed HR02 results (release gate input; holidays have no gazette). */
  emptyWeekdays: string[];
}

/** All matching HR02 metas in [start, end], deduplicated by id, listed month by month. */
export async function listWindow(start: string, end: string, log = console.log) {
  const metas = new Map<string, PublicationMeta>();
  const byQuery: Record<string, number> = {};
  for (let from = start; from <= end; from = addDays(from, CHUNK_DAYS)) {
    const to = minDate(addDays(from, CHUNK_DAYS - 1), end);
    for (const q of INGEST_QUERIES) {
      const found = (await searchAll({ keyword: q.keyword, subRubrics: ["HR02"], start: from, end: to })).filter((m) => m.language === q.language);
      byQuery[q.keyword] = (byQuery[q.keyword] ?? 0) + found.length;
      for (const m of found) metas.set(m.id, m);
    }
    log(`listed ${from}..${to}: ${metas.size} unique so far`);
  }
  return { metas: [...metas.values()], byQuery };
}

export function emptyWeekdays(metas: readonly { publishedAt: string }[], start: string, end: string): string[] {
  const days = new Set(metas.map((m) => m.publishedAt));
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isoWeekday(d) < 5 && !days.has(d)) out.push(d);
  return out;
}

async function pool<T>(items: T[], n: number, work: (item: T) => Promise<void>, stop: () => boolean) {
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length && !stop()) await work(items[next++]!);
    }),
  );
}

export async function ingestWindow(start: string, end: string, opts: { dryRun?: boolean; log?: (s: string) => void } = {}): Promise<IngestStats> {
  const log = opts.log ?? console.log;
  const stats: IngestStats = { listed: 0, alreadyStored: 0, fetched: 0, stored: 0, parseFailures: 0, fetchFailures: 0, skippedOnConflict: 0, byQuery: {}, emptyWeekdays: [] };
  const errors: { id: string; stage: string; message: string }[] = [];
  const counts = () => ({ window: { start, end }, parserVersion: PARSER_VERSION, ...stats });
  // The run row comes first, so listing failures and killed runs leave a record too.
  const run = opts.dryRun ? null : (await db().insert(ingestRuns).values({ counts: counts() }).returning({ id: ingestRuns.id }))[0]!;
  const finish = async (status: "succeeded" | "failed") => {
    if (run) await db().update(ingestRuns).set({ status, finishedAt: sql`now()`, counts: counts(), errors }).where(eq(ingestRuns.id, run.id));
  };

  try {
    const { metas, byQuery } = await listWindow(start, end, log);
    stats.listed = metas.length;
    stats.byQuery = byQuery;
    stats.emptyWeekdays = emptyWeekdays(metas, start, end);
    const ids = metas.map((m) => m.id);
    const stored = new Set<string>();
    for (let i = 0; i < ids.length; i += 1000) {
      const rows = await db().select({ id: publications.id }).from(publications).where(inArray(publications.id, ids.slice(i, i + 1000)));
      for (const r of rows) stored.add(r.id);
    }
    stats.alreadyStored = stored.size;
    const todo = metas.filter((m) => !stored.has(m.id));
    log(`${metas.length} listed, ${stored.size} already stored, ${todo.length} to fetch${opts.dryRun ? " (dry run: nothing fetched or written)" : ""}`);
    if (opts.dryRun) return stats;

    let batch: (typeof publications.$inferInsert)[] = [];
    let aborted: Error | null = null;
    const flush = async () => {
      if (!batch.length) return;
      const rows = batch;
      batch = [];
      const written = await db().insert(publications).values(rows).onConflictDoNothing().returning({ id: publications.id });
      stats.stored += written.length;
      const writtenIds = new Set(written.map((w) => w.id));
      for (const r of rows) {
        if (writtenIds.has(r.id)) continue;
        stats.skippedOnConflict++;
        errors.push({ id: r.id, stage: "store", message: `skipped on conflict (${r.publicationNumber})` });
      }
    };
    let lastLogged = 0;
    await pool(
      todo,
      CONCURRENCY,
      async (m) => {
        let xml: string;
        try {
          xml = await fetchPublicationXml(m.id, { cache: false });
          stats.fetched++;
        } catch (e) {
          stats.fetchFailures++;
          errors.push({ id: m.id, stage: "fetch", message: (e as Error).message });
          return;
        }
        try {
          parsePublication(xml);
        } catch (e) {
          // Stored anyway (raw snapshots are the source of truth); counted for the release gate.
          stats.parseFailures++;
          errors.push({ id: m.id, stage: "parse", message: (e as Error).message });
        }
        batch.push({ id: m.id, publicationNumber: m.publicationNumber, rubric: "HR", subRubric: m.subRubric, language: m.language, publishedAt: m.publishedAt, companyUid: publicationUid(xml), rawXml: xml });
        try {
          if (batch.length >= INSERT_BATCH) await flush();
        } catch (e) {
          aborted = e as Error;
        }
        if (stats.fetched - lastLogged >= 250) {
          lastLogged = stats.fetched;
          log(`fetched ${stats.fetched}/${todo.length}`);
        }
      },
      () => aborted !== null,
    );
    if (aborted) throw aborted;
    await flush();
    const parseRate = stats.fetched ? stats.parseFailures / stats.fetched : 0;
    await finish(stats.fetchFailures || stats.skippedOnConflict || parseRate > MAX_PARSE_FAILURE_RATE ? "failed" : "succeeded");
    return stats;
  } catch (e) {
    errors.push({ id: "-", stage: "run", message: (e as Error).message });
    await finish("failed");
    throw e;
  }
}
