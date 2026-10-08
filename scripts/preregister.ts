// T1 eval pre-registration. Protocol: eval/preregistration/PREREGISTRATION.md.
//
//   npm run preregister -- crawl              crawl startupticker Financing → candidates.json
//   npm run preregister -- shuffle            seeded order → screening.csv (refuses to overwrite)
//   npm run preregister -- fetch <from> <to>  article text for ranks → .data/startupticker/ (gitignored)
//   npm run preregister -- zefix <name>       sealed registry lookup (name, UID, legal form, seat)
//   npm run preregister -- finalize           screening.csv → eval/cohort.json + spike ledger entries
//   npm run preregister -- scrub              replace names from .data/person-names.txt with tokens
//   npm run preregister -- check              no listed names left; cohort ∩ inspected ledger empty
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv, parseCsv } from "../eval/lib/csv";
import { assignPartitions, overlap } from "../eval/lib/partition";
import {
  SCREENING_COLUMNS,
  candidatesFile,
  cohortFile,
  screeningOutcome,
  type CohortRound,
  type InspectedEntry,
} from "../eval/lib/schemas";
import { readLedger, today, writeLedger } from "../eval/lib/ledger";
import { assertNoListedNames, loadNameList, scrub } from "../eval/lib/scrub";
import { seededShuffle } from "../eval/lib/seeded";
import { BASE, fetchArticle, fetchFinancingPage } from "../lib/pipeline/startupticker";
import { ZEFIX_LEGAL_FORM_AG, ZEFIX_LEGAL_FORM_GMBH, searchFirms } from "../lib/pipeline/zefix";
import { formatUid } from "../lib/domain/uid";

const SEED = 2613906888;
const WINDOW = { start: "2025-12-01", end: "2026-04-08" } as const;
const MATCH_WINDOW_DAYS = { before: 120, after: 180 } as const;
const MAX_PAGES = 40;

const DIR = "eval/preregistration";
const CANDIDATES = join(DIR, "candidates.json");
const SCREENING = join(DIR, "screening.csv");
const COHORT = "eval/cohort.json";
const ARTICLES = ".data/startupticker";
const UNSCRUBBED = ".data/preregistration-unscrubbed";

const writeJson = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n");

async function crawl() {
  const seen = new Map<string, { date: string; title: string; url: string }>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await fetchFinancingPage(page);
    for (const it of items) if (it.date >= WINDOW.start && it.date <= WINDOW.end) seen.set(it.url, it);
    const oldest = items.reduce((m, it) => (it.date < m ? it.date : m), "9999-12-31");
    console.log(`page ${page}: ${items.length} items, oldest ${oldest}, in window so far ${seen.size}`);
    if (oldest < WINDOW.start) break;
    if (page === MAX_PAGES) throw new Error(`reached page ${MAX_PAGES} without passing ${WINDOW.start}`);
  }
  const candidates = [...seen.values()].sort((a, b) => a.url.localeCompare(b.url));
  writeJson(CANDIDATES, {
    crawledAt: new Date().toISOString(),
    source: `${BASE}/en/topics?category=Financing`,
    window: WINDOW,
    candidates,
  });
  console.log(`wrote ${candidates.length} candidates → ${CANDIDATES}`);
}

function shuffle() {
  if (existsSync(SCREENING)) throw new Error(`${SCREENING} exists; refusing to overwrite screening work`);
  const { candidates } = candidatesFile.parse(JSON.parse(readFileSync(CANDIDATES, "utf8")));
  const ordered = seededShuffle(candidates, SEED);
  const rows = ordered.map((c, i) => ({ rank: String(i + 1), announced: c.date, title: c.title, url: c.url }));
  writeFileSync(SCREENING, toCsv(SCREENING_COLUMNS, rows));
  console.log(`wrote ${rows.length} rows in seeded order → ${SCREENING}`);
}

async function fetchArticles(from: number, to: number) {
  mkdirSync(ARTICLES, { recursive: true });
  const rows = parseCsv(readFileSync(SCREENING, "utf8"));
  for (const row of rows.filter((r) => +r.rank! >= from && +r.rank! <= to)) {
    const file = join(ARTICLES, `${row.rank!.padStart(3, "0")}.txt`);
    if (existsSync(file)) continue;
    const a = await fetchArticle(row.url!);
    writeFileSync(
      file,
      `# ${row.rank} · ${row.announced} · ${a.title}\n${row.url}\nlinked companies: ${a.companies.join(" | ") || "-"}\n\n${a.body}\n`,
    );
    console.log(`${row.rank}: ${a.title} [${a.companies.join(" | ")}]`);
  }
}

async function zefix(name: string) {
  const firms = await searchFirms(name);
  if (firms.length === 0) console.log("no match");
  for (const f of firms) {
    const form = f.legalFormId === ZEFIX_LEGAL_FORM_AG ? "AG" : f.legalFormId === ZEFIX_LEGAL_FORM_GMBH ? "GmbH" : `form ${f.legalFormId}`;
    console.log(`${f.uid} | ${formatUid(f.uid)} | ${f.name} | ${form} | ${f.legalSeat} | ${f.status}`);
  }
}

function finalize() {
  const rows = parseCsv(readFileSync(SCREENING, "utf8"));
  const screened = rows.filter((r) => r.outcome);
  // Screening must be contiguous in seeded order: no skipped ranks before the last screened one.
  const lastRank = Math.max(0, ...screened.map((r) => +r.rank!));
  const gaps = rows.filter((r) => +r.rank! <= lastRank && !r.outcome).map((r) => r.rank);
  if (gaps.length) throw new Error(`unscreened ranks before ${lastRank}: ${gaps.join(", ")}`);

  const eligible: CohortRound[] = [];
  for (const r of screened) {
    const outcome = screeningOutcome.parse(r.outcome);
    if (outcome !== "eligible") {
      if (!r.note) throw new Error(`rank ${r.rank}: exclusion ${outcome} needs a note`);
      continue;
    }
    if (r.legal_form !== "AG") throw new Error(`rank ${r.rank}: eligible but legal_form=${r.legal_form}`);
    eligible.push({
      rank: +r.rank!,
      uid: r.uid!,
      company: r.company!,
      announced: r.announced!,
      url: r.url!,
      title: r.title!,
    });
  }
  const result = assignPartitions(eligible);
  const draft = cohortFile.parse({
    seed: SEED,
    window: WINDOW,
    matchWindowDays: MATCH_WINDOW_DAYS,
    spike: result.spike,
    cohort: result.cohort,
  });
  const counts = Object.groupBy(screened, (r) => r.outcome!);
  console.log(
    `screened ${screened.length} (${Object.entries(counts).map(([k, v]) => `${k} ${v!.length}`).join(", ")}); ` +
      `spike ${result.spike.length}, cohort ${result.cohort.length}, unused ${result.unused.length}`,
  );
  if (!result.complete) throw new Error("quotas not met: screen further in seeded order");

  writeJson(COHORT, draft);
  const ledger = readLedger().filter((e) => e.source !== "spike");
  const spikeEntries = [...new Map(draft.spike.map((r) => [r.uid, r])).values()].map(
    (r): InspectedEntry => ({ uid: r.uid, company: r.company, source: "spike", added: today() }),
  );
  writeLedger([...spikeEntries, ...ledger]);
  console.log(`wrote ${COHORT} and the inspected ledger`);
  check();
}

// Committed eval files must not name people (some startupticker headlines do). The real
// titles and URLs stay in the gitignored backup for day-2 adjudication.
function scrubFiles() {
  const names = loadNameList();
  mkdirSync(UNSCRUBBED, { recursive: true });
  for (const file of [CANDIDATES, SCREENING, COHORT]) {
    const text = readFileSync(file, "utf8");
    const backup = join(UNSCRUBBED, file.replace(/[\\/]/g, "__"));
    if (!existsSync(backup)) writeFileSync(backup, text);
    writeFileSync(file, scrub(text, names));
  }
  check();
}

/** Every committed data file under eval/ (code excluded). */
function evalDataFiles(dir = "eval"): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return evalDataFiles(p);
    return /\.(json|csv|md|xml)$/.test(f) ? [p] : [];
  });
}

function check() {
  const names = loadNameList(); // throws when missing: no silent pass on a fresh clone
  const files = evalDataFiles();
  for (const file of files) assertNoListedNames(file, readFileSync(file, "utf8"), names);
  const cohort = cohortFile.parse(JSON.parse(readFileSync(COHORT, "utf8")));
  const bad = overlap(
    readLedger().map((e) => e.uid),
    cohort.cohort.map((r) => r.uid),
  );
  if (bad.length) throw new Error(`cohort UIDs in the inspected ledger: ${bad.join(", ")}`);
  console.log(`check ok: no listed names in ${files.length} eval files; ${cohort.cohort.length} cohort rounds, none in the inspected ledger`);
}

const [cmd, ...args] = process.argv.slice(2);
const commands: Record<string, () => unknown> = {
  crawl,
  shuffle,
  fetch: () => fetchArticles(Number(args[0]), Number(args[1])),
  zefix: () => zefix(args.join(" ")),
  finalize,
  scrub: scrubFiles,
  check,
};
const run = commands[cmd ?? ""];
if (!run) {
  console.error(`usage: preregister <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
await run();
