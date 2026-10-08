// Crawls startupticker.ch financing news into a local article cache that build-release matches
// against our companies (lib/pipeline/confirmations.ts). Articles never change, so each is
// fetched once; the daily workflow keeps the cache between runs (actions/cache). The crawl
// respects robots.txt (5 s delay) and fetches at most --max (1,000) new articles per run: the first run takes about 70 min, later runs a few.
//
//   npm run confirmations -- [--max 1000] [--dry-run]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { addDays } from "../lib/domain/dates";
import { BACKFILL_START } from "../lib/pipeline/candidates";
import { ARTICLE_CACHE, readArticleCache } from "../lib/pipeline/confirmations-cache";
import { MATCH_WINDOW } from "../lib/pipeline/confirmations";
import { fetchArticle, fetchFinancingPage } from "../lib/pipeline/startupticker";

const args = process.argv.slice(2);
const i = args.indexOf("--max");
const max = i >= 0 ? Number(args[i + 1]) : 1000;
const dryRun = args.includes("--dry-run");
// Announcements up to 180 days before the backfill can still confirm an increase in it.
const since = addDays(BACKFILL_START, -MATCH_WINDOW.after);

const cache = readArticleCache();
const listed: { url: string; date: string }[] = [];
for (let page = 1; page <= 200; page++) {
  const items = await fetchFinancingPage(page);
  listed.push(...items.filter((it) => it.date >= since));
  const oldest = items.reduce((m, it) => (it.date < m ? it.date : m), "9999-12-31");
  // Stop at the window start, or once a whole page is already cached (older pages are too).
  if (oldest < since || items.every((it) => cache[it.url])) break;
}
const missing = listed.filter((it) => !cache[it.url]);
console.log(`[confirmations] listed ${listed.length} since ${since}; cached ${listed.length - missing.length}; fetching ${Math.min(max, missing.length)} of ${missing.length} new`);
if (dryRun) process.exit(0);

let fetched = 0;
for (const it of missing.slice(0, max)) {
  try {
    const a = await fetchArticle(it.url);
    cache[it.url] = { date: it.date, title: a.title, companies: a.companies };
    fetched++;
  } catch (e) {
    console.error(`[confirmations] ${it.url}: ${(e as Error).message}`);
  }
}
mkdirSync(dirname(ARTICLE_CACHE), { recursive: true });
writeFileSync(ARTICLE_CACHE, JSON.stringify(cache) + "\n");
console.log(`[confirmations] fetched ${fetched}; cache holds ${Object.keys(cache).length} articles`);
if (missing.length > max) console.log(`[confirmations] ${missing.length - max} left for the next runs`);
