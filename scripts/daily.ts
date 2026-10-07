// The daily job (GitHub Actions, .github/workflows/daily.yml; runnable locally too):
// ingest the latest gazette days → fetch history for new companies → classify new candidates →
// build a release (activated only if every gate passes, eval included) → prune old releases.
// Any failing step stops the run; the site keeps serving the last good release.
//
//   npm run daily -- [--dry-run]
import { spawnSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { addDays, zurichDate } from "../lib/domain/dates";

/** Re-read a few days back: late or corrected entries of recent days are picked up too. */
const LOOKBACK_DAYS = 7;
const dryRun = process.argv.includes("--dry-run");

const latest = ((await db().execute(sql`select max(published_at)::text as d from publications where sub_rubric = 'HR02'`)).rows[0] as { d: string | null }).d;
if (!latest) throw new Error("no stored HR02 publications: run the backfill first");
const today = zurichDate(new Date());
const start = addDays(latest, -LOOKBACK_DAYS);
console.log(`[daily] latest stored ${latest}; ingest ${start}..${today}${dryRun ? " (dry run)" : ""}`);

const steps: [string, string[]][] = [
  ["ingest", ["--start", start, "--end", today]],
  ["history", ["--run", "daily", "--only-new"]],
  ["classify", ["backfill"]],
  ["build-release", ["--release", "auto"]],
  ["prune-releases", []],
];
for (const [script, args] of steps) {
  const runArgs = dryRun ? (script === "ingest" || script === "history" || script === "prune-releases" ? [...args, "--dry-run"] : null) : args;
  if (!runArgs) {
    console.log(`[daily] ${script}: skipped in dry run`);
    continue;
  }
  console.log(`[daily] ${script} ${runArgs.join(" ")}`);
  const r = spawnSync("npm", ["run", "-s", script, "--", ...runArgs], { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`[daily] ${script} failed (exit ${r.status}); stopping. The site keeps serving the last good release.`);
    process.exit(r.status || 1);
  }
}
console.log("[daily] done");
