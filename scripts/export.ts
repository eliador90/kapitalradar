// Dataset export (T12). Writes the CSV and its data card under .data/export/ only: nothing is
// published or exposed until the SHAB reuse terms are confirmed (Open Question 1).
//
//   npm run export -- --release r1
import { mkdirSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { loadNameList } from "../eval/lib/scrub";
import { toCsv } from "../eval/lib/csv";
import { EXPORT_COLUMNS, exportGate, exportRow, type ExportSource } from "../lib/pipeline/export";
import { PARSER_VERSION } from "../lib/pipeline/parse";

const i = process.argv.indexOf("--release");
const releaseId = i >= 0 ? process.argv[i + 1] : undefined;
if (!releaseId || !/^r\d+$/.test(releaseId)) throw new Error("usage: export --release r<N>");

const [rel] = (await db().execute(sql`select id, snapshot_date::text as snapshot, backfill_start::text as backfill, config from releases where id = ${releaseId}`)).rows as { id: string; snapshot: string; backfill: string; config: { modelId: string; promptVersion: string } }[];
if (!rel) throw new Error(`release ${releaseId} not found`);

const rows = (
  await db().execute(sql`
    select e.company_uid as uid,
           (select n.name from company_names n where n.release_id = e.release_id and n.company_uid = e.company_uid order by n.published_at desc limit 1) as "companyName",
           e.payload->>'canton' as canton, e.payload->>'legalForm' as "legalForm",
           e.legal_date::text as "legalDate", e.published_at::text as "publishedAt",
           p.publication_number as "publicationNumber", e.publication_id as "publicationId",
           e.currency, e.capital_before::text as "capitalBefore", e.capital_after::text as "capitalAfter",
           e.shares_before as "sharesBefore", e.shares_after as "sharesAfter", a.tier
    from events e
    join publications p on p.id = e.publication_id
    left join assessments a on a.event_id = e.id and a.release_id = e.release_id
    where e.release_id = ${releaseId} and e.type = 'capital_change'
    order by e.published_at, p.publication_number, e.seq`)
).rows as unknown as ExportSource[];

const out = rows.map((r) => exportRow({ ...r, sharesBefore: r.sharesBefore === null ? null : Number(r.sharesBefore), sharesAfter: r.sharesAfter === null ? null : Number(r.sharesAfter) }, rel.config));
// Blocking gate before any file is written (plan E6 "Gate").
const violations = exportGate(out, loadNameList());
if (violations.length) {
  console.error(`export blocked: ${violations.length} person-data hits`);
  for (const v of violations.slice(0, 20)) console.error(`  ${v}`);
  process.exit(1);
}

const dir = ".data/export";
mkdirSync(dir, { recursive: true });
const file = `${dir}/kapitalradar-${releaseId}.csv`;
writeFileSync(file, toCsv(EXPORT_COLUMNS, out));
writeFileSync(
  `${dir}/DATA_CARD-${releaseId}.md`,
  `# Kapitalradar dataset · release ${releaseId}

- Snapshot (asOf): ${rel.snapshot}; publications from ${rel.backfill}
- Rows: ${out.length} capital-change events (${out.filter((r) => r.tier !== "not_assessed").length} assessed)
- Parser version ${PARSER_VERSION}; classifier ${rel.config.modelId}, prompt version ${rel.config.promptVersion}
- Columns: ${EXPORT_COLUMNS.join(", ")}
- Excluded: gazette text (purpose included), person data, evaluation labels
- License / reuse terms: pending (SHAB reuse terms, Open Question 1). Not published.
- Hosting: not hosted
`,
);
console.log(`${out.length} rows → ${file} (gate passed)`);
