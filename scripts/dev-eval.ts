// Rules-only dev evaluation (T6). Dev set = Assignment labels + labeled spike rounds; it shapes
// rules and the threshold and is never reported as precision or recall (plan "Labels").
//
//   npm run dev-eval -- spike-labels   draft labels for the matched spike rounds (Claude draft, Remo reviews)
//   npm run dev-eval -- run            features from Neon, rule hits, threshold fit → eval/dev/rules-dev-report.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { companySources } from "../db/schema";
import { cohortFile } from "../eval/lib/schemas";
import { loadCompany } from "../lib/pipeline/candidates";
import { refreshHistory } from "../lib/pipeline/history";
import { parsePublication } from "../lib/pipeline/parse";
import { defaultRuleConfig, fitThreshold } from "../lib/pipeline/rules";

const SPIKE_LABELS = "eval/dev/spike-labels.json";
const REPORT = "eval/dev/rules-dev-report.json";

const devLabel = z.object({
  id: z.string(),
  uid: z.string(),
  source: z.enum(["assignment", "spike"]),
  startup_relevance: z.enum(["yes", "no", "unknown"]),
  transaction_type: z.enum(["new_equity", "conversion_only", "restructuring", "esop", "unknown"]),
  labeler: z.string(),
  provenance: z.enum(["text_only", "verified"]),
  sourceUrl: z.string().optional(),
});
type DevLabel = z.infer<typeof devLabel>;

function spikeLabels() {
  const m = JSON.parse(readFileSync("eval/spike/matches.json", "utf8"));
  const { spike } = cohortFile.parse(JSON.parse(readFileSync("eval/cohort.json", "utf8")));
  const labels: DevLabel[] = [];
  for (const row of m.rows) {
    if (!row.adjudication?.accepted) continue;
    const round = spike.find((r) => r.rank === row.rank)!;
    const xml = readFileSync(`.data/shab/${row.adjudication.accepted}.xml`, "utf8");
    const e = parsePublication(xml).events.find((x) => x.type === "capital_change");
    const c = e?.type === "capital_change" ? e.contributionType : "unknown";
    // Mechanics from the gazette; relevance from the announcement (all spike rounds are startup rounds).
    const transaction_type = c === "set_off" ? "conversion_only" : c === "in_kind" ? "restructuring" : c === "conditional_capital" ? "esop" : c === "cash" || c === "mixed" ? "new_equity" : "unknown";
    labels.push({ id: row.adjudication.accepted, uid: row.uid, source: "spike", startup_relevance: "yes", transaction_type, labeler: "claude_draft_pending_remo", provenance: "verified", sourceUrl: round.url });
  }
  writeFileSync(SPIKE_LABELS, JSON.stringify({ note: "Claude draft from gazette mechanics + startupticker announcement; pending Remo's review", labels }, null, 2) + "\n");
  console.log(`wrote ${labels.length} spike labels → ${SPIKE_LABELS}: ${labels.filter((l) => l.transaction_type === "new_equity").length} new_equity`);
}

function devSet(): DevLabel[] {
  const a = JSON.parse(readFileSync("eval/dev/assignment-labels.json", "utf8")).labels.map((l: Record<string, unknown>) =>
    devLabel.parse({ id: l.id, uid: l.uid, source: "assignment", startup_relevance: l.startup_relevance, transaction_type: l.transaction_type, labeler: l.labeler, provenance: l.provenance, sourceUrl: l.source }),
  );
  const s = existsSync(SPIKE_LABELS) ? z.array(devLabel).parse(JSON.parse(readFileSync(SPIKE_LABELS, "utf8")).labels) : [];
  return [...a, ...s];
}

async function run() {
  const items = devSet();
  const rows = [];
  for (const item of items) {
    const [src] = await db().select().from(companySources).where(eq(companySources.companyUid, item.uid));
    if (!src) await refreshHistory(item.uid);
    const company = await loadCompany(item.uid);
    const c = company.capitalChanges.find((x) => x.publication.id === item.id);
    if (!c) throw new Error(`dev item ${item.id} (${item.source}) has no capital change in publications`);
    const positive = item.startup_relevance === "yes" && item.transaction_type === "new_equity";
    const unknown = item.startup_relevance === "unknown" || item.transaction_type === "unknown";
    rows.push({ id: item.id, source: item.source, publicationNumber: c.publication.publicationNumber, positive, unknown, ...c.rules, contribution: c.event.contributionType });
  }
  const scored = rows.filter((r) => !r.unknown); // plan: unknown labels are excluded from dev metrics
  const best = fitThreshold(scored);
  const config = defaultRuleConfig(best.threshold);
  const ruleStats = Object.fromEntries(
    Object.keys(config.weights).map((id) => {
      const hit = scored.filter((r) => r.hits.includes(id as never));
      return [id, { fired: hit.length, positives: hit.filter((r) => r.positive).length }];
    }),
  );
  const report = {
    note: "Dev data only: shapes rules and the threshold, never reported as precision or recall.",
    devItems: rows.length,
    excludedUnknown: rows.length - scored.length,
    positives: scored.filter((r) => r.positive).length,
    preFilterRecall: scored.filter((r) => r.positive && r.candidate).length / Math.max(1, scored.filter((r) => r.positive).length),
    threshold: best,
    ruleStats,
    rows,
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
  for (const r of scored.filter((x) => x.positive !== (x.candidate && x.score >= best.threshold))) {
    console.log(`  ${r.positive ? "MISS" : "FALSE+"} ${r.source} ${r.publicationNumber} score ${r.score} [${r.hits.join(", ")}] ${r.contribution} ${r.rejectReason ?? ""}`);
  }
}

const [cmd] = process.argv.slice(2);
if (cmd === "spike-labels") spikeLabels();
else if (cmd === "run") await run();
else {
  console.error("usage: dev-eval <spike-labels|run>");
  process.exit(1);
}
