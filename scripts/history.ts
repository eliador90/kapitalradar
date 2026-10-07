// Company history fetch (T5) for every capital-increase candidate in `publications`.
// Logs counts only: the candidates include sealed cohort companies.
//
//   npm run history -- --run 2026-10-06 --dry-run
//   npm run history -- --run 2026-10-06 [--limit 20]
//   npm run history -- --run any --recompute   re-derive founding/coverage columns, no network
//   npm run history -- --run daily --only-new   companies without a fetched history (daily job)
import { BACKFILL_START, listCandidateUids } from "../lib/pipeline/candidates";
import { recomputeSources, runHistory } from "../lib/pipeline/history";
import { db } from "../db/client";
import { companySources } from "../db/schema";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const runKey = arg("run");
if (!runKey) {
  console.error("usage: history --run <key> [--limit N] [--dry-run]");
  process.exit(1);
}

if (args.includes("--recompute")) {
  // Derived columns only (founding date, formation, counts), from stored data: no network.
  await recomputeSources();
  process.exit(0);
}

// --only-new: companies without a fetched history yet (the daily run); otherwise every candidate.
const candidates = await listCandidateUids(BACKFILL_START);
const known = args.includes("--only-new") ? new Set((await db().select({ uid: companySources.companyUid }).from(companySources)).map((r) => r.uid)) : new Set<string>();
const all = candidates.filter((u) => !known.has(u));
const limit = arg("limit") === undefined ? all.length : Number(arg("limit"));
if (!Number.isInteger(limit) || limit < 0) {
  console.error("--limit needs a non-negative integer");
  process.exit(1);
}
const uids = all.slice(0, limit);
console.log(`${all.length} candidate companies${limit < all.length ? `, running the first ${limit}` : ""}`);
if (args.includes("--dry-run")) process.exit(0);
const stats = await runHistory(uids, runKey, { concurrency: 6 });
console.log(JSON.stringify(stats, null, 2));
if (stats.failed) process.exitCode = 2;
