// Backfill ingest (T4). Lists HR02 capital, band and conversion publications and stores new ones.
//
//   npm run ingest -- --start 2025-08-01 --end 2026-10-05 --dry-run
//   npm run ingest -- --start 2025-08-01 --end 2026-10-05
import { isIsoDate } from "../lib/domain/dates";
import { ingestWindow } from "../lib/pipeline/fetch";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const start = arg("start") ?? "2025-08-01";
const end = arg("end");
if (!end || !isIsoDate(start) || !isIsoDate(end) || start > end) {
  console.error("usage: ingest --start YYYY-MM-DD --end YYYY-MM-DD [--dry-run]");
  process.exit(1);
}
const stats = await ingestWindow(start, end, { dryRun: args.includes("--dry-run") });
console.log(JSON.stringify(stats, null, 2));
if (stats.fetchFailures || stats.parseFailures) process.exitCode = 2;
