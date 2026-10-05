// T2 data spike. Dev-only: reads gazette entries of spike companies, never cohort ones.
//
//   npm run spike -- match     spike rounds → candidate capital increases in −120/+180 days
//   npm run spike -- archive   archive depth + request latency
//   npm run spike -- band      capital-band publishing sample
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cohortUids } from "../eval/lib/ledger";
import { cohortFile } from "../eval/lib/schemas";
import { daysBetween } from "../lib/domain/dates";
import { readCapital } from "../lib/pipeline/capital";
import { rateLimitedCount } from "../lib/pipeline/http";
import { cachePublicationXml, fetchPublicationXml, searchByUid, searchPage } from "../lib/pipeline/shab";

const OUT_DIR = "eval/spike";

interface Increase {
  id: string;
  publicationNumber: string;
  publishedAt: string;
  lagDays: number; // publishedAt − announced; negative = gazette first
  before: number;
  after: number;
  setOff: boolean;
  capitalBand: boolean;
}

async function match() {
  const { spike, matchWindowDays } = cohortFile.parse(JSON.parse(readFileSync("eval/cohort.json", "utf8")));
  const sealed = cohortUids();
  const rows = [];
  for (const round of spike) {
    // The UID keyword search also returns entries that merely cite the UID (mergers, parents):
    // keep only the company's own publications, and never cache a cohort company's entry.
    const own = [];
    for (const m of await searchByUid(round.uid)) {
      const xml = await fetchPublicationXml(m.id, { cache: false });
      const c = readCapital(xml);
      if (c.uid && sealed.has(c.uid)) continue;
      if (c.uid !== round.uid) continue;
      cachePublicationXml(m.id, xml);
      own.push({ m, c });
    }
    const increases: Increase[] = own
      .filter(({ m, c }) => m.subRubric === "HR02" && c.isIncrease)
      .map(({ m, c }) => ({
        id: m.id,
        publicationNumber: m.publicationNumber,
        publishedAt: m.publishedAt,
        lagDays: daysBetween(round.announced, m.publishedAt),
        before: c.before,
        after: c.after,
        setOff: c.setOff,
        capitalBand: c.capitalBand,
      }));
    const inWindow = increases.filter((i) => i.lagDays >= -matchWindowDays.before && i.lagDays <= matchWindowDays.after);
    rows.push({
      rank: round.rank,
      uid: round.uid,
      company: round.company,
      announced: round.announced,
      publications: own.length,
      earliestPublication: own.map(({ m }) => m.publishedAt).sort()[0] ?? null,
      formationFound: own.some(({ m }) => m.subRubric === "HR01"),
      increasesTotal: increases.length,
      candidates: inWindow,
      // Filled by hand: accepted publication id, or null with a reason (eng V6 adjudication).
      adjudication: { accepted: null as string | null, note: "" },
    });
    const c = inWindow.map((i) => `${i.publishedAt} (${i.lagDays >= 0 ? "+" : ""}${i.lagDays}d)`).join(", ");
    console.log(`${round.rank} ${round.company}: ${own.length} pubs, ${increases.length} increases, window: ${c || "none"}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/matches.json`, JSON.stringify({ matchWindowDays, rows }, null, 2) + "\n");
  const found = rows.filter((r) => r.candidates.length > 0).length;
  const multi = rows.filter((r) => r.candidates.length > 1).length;
  console.log(`found ${found}/${rows.length} with ≥1 candidate in window (${multi} with several → manual review)`);
}

async function archive() {
  for (const [start, end, keyword] of [
    ["2016-01-01", "2016-12-31", undefined],
    ["2018-06-01", "2018-12-31", undefined],
    ["2018-06-01", "2018-06-30", "Aktienkapital"],
    ["2019-01-01", "2019-01-31", "Aktienkapital"],
  ] as const) {
    const t0 = Date.now();
    const { total } = await searchPage({ keyword, subRubrics: ["HR02"], start, end }, 0, 1);
    console.log(`${start}..${end} HR02 ${keyword ?? "(no keyword)"}: ${total} publications (${Date.now() - t0} ms)`);
  }
  const lat: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    await searchPage({ keyword: "Aktienkapital", subRubrics: ["HR02"], start: "2026-09-01", end: "2026-09-30" }, i, 10);
    lat.push(Date.now() - t0);
  }
  lat.sort((a, b) => a - b);
  console.log(`20 sequential searches at 500 ms spacing: median ${lat[10]} ms, max ${lat[19]} ms, ${rateLimitedCount()} HTTP 429 seen`);
}

async function band() {
  const sealed = cohortUids();
  const { total, items } = await searchPage({ keyword: "Kapitalband", subRubrics: ["HR02"], start: "2026-06-01", end: "2026-09-30" }, 0, 40);
  let viaBand = 0;
  let adoptions = 0;
  let skipped = 0;
  for (const m of items) {
    const c = readCapital(await fetchPublicationXml(m.id, { cache: false }));
    if (c.uid && sealed.has(c.uid)) {
      skipped++;
      continue;
    }
    if (c.isIncrease) viaBand++;
    else adoptions++;
  }
  console.log(`${total} HR02 mentioning Kapitalband (Jun–Sep 2026); sample of ${items.length - skipped}: ${viaBand} with a capital increase, ${adoptions} without (${skipped} cohort entries skipped unseen)`);
}

const [cmd] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = { match, archive, band };
const run = commands[cmd ?? ""];
if (!run) {
  console.error(`usage: spike <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
await run();
