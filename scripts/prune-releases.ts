// Deletes old releases' rows so daily builds fit the free database tier. Keeps the current
// release and the newest other ready release (rollback target). Raw publications, history and
// cached classifications are shared across releases and never touched.
//
//   npm run prune-releases -- --dry-run
//   npm run prune-releases -- [--keep 2]
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { assessments, companyNames, confirmations, currentRelease, events, ingestRuns, releases } from "../db/schema";
import { releasesToPrune } from "../lib/pipeline/release";

const args = process.argv.slice(2);
const i = args.indexOf("--keep");
const keep = i >= 0 ? Number(args[i + 1]) : 2;
if (!Number.isInteger(keep) || keep < 1) throw new Error("--keep needs an integer ≥ 1");

const all = await db().select({ id: releases.id, status: releases.status }).from(releases);
const [cur] = await db().select({ id: currentRelease.releaseId }).from(currentRelease).where(eq(currentRelease.id, 1));
const prune = releasesToPrune(all, cur?.id ?? null, keep);
console.log(`current ${cur?.id ?? "none"}; ${all.length} releases; pruning ${prune.length ? prune.join(", ") : "nothing"}`);
if (!prune.length || args.includes("--dry-run")) process.exit(0);
if (cur && prune.includes(cur.id)) throw new Error("refusing to prune the current release");

// One transaction, children first (foreign keys).
await db().batch([
  db().delete(confirmations).where(inArray(confirmations.releaseId, prune)),
  db().delete(assessments).where(inArray(assessments.releaseId, prune)),
  db().delete(events).where(inArray(events.releaseId, prune)),
  db().delete(companyNames).where(inArray(companyNames.releaseId, prune)),
  db().update(ingestRuns).set({ releaseId: null }).where(inArray(ingestRuns.releaseId, prune)),
  db().delete(releases).where(inArray(releases.id, prune)),
]);
const size = (await db().execute(sql`select pg_size_pretty(pg_database_size(current_database())) s`)).rows[0] as { s: string };
console.log(`pruned ${prune.length} releases; database ${size.s}`);
