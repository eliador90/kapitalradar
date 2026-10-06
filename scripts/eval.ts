// Release evaluation (T9). Reads the adjudicated cohort, classifications and the frozen config;
// never the `confirmations` table (plan: the eval-isolation test enforces it).
//
//   npm run eval -- adjudicate   .data/cohort/adjudication.md → eval/cohort-adjudication.json
//   npm run eval -- recall       recall per system + pre-filter ceiling → eval/results/recall.json
//   npm run eval -- run          full release eval artifact → eval/results/release-eval.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { cohortFile } from "../eval/lib/schemas";
import { recall } from "../lib/domain/metrics";
import { loadCompany } from "../lib/pipeline/candidates";
import { dbClassificationStore } from "../lib/pipeline/classification-store";
import { tierFor } from "../lib/pipeline/classify";
import { loadClassificationConfig, ruleConfigFrom } from "../lib/pipeline/config";

const ADJ = "eval/cohort-adjudication.json";
const RESULTS = "eval/results";

const adjudication = z.object({
  reviewedBy: z.string(),
  rows: z.array(
    z.object({
      rank: z.number(),
      uid: z.string(),
      verdict: z.enum(["accepted", "none", "uncertain"]),
      publicationId: z.string().nullable(),
      note: z.string(),
    }),
  ),
});

function adjudicate() {
  const sheet = readFileSync(".data/cohort/adjudication.md", "utf8");
  const m = JSON.parse(readFileSync("eval/cohort-matches.json", "utf8"));
  const rows = sheet
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const rank = Number(block.match(/^(\d+)/)![1]);
      const accepted = block.match(/^- accepted: (.+)$/m)![1]!.trim();
      const note = block.match(/^- note: (.+)$/m)![1]!.trim();
      const row = m.rows.find((r: { rank: number }) => r.rank === rank);
      const hit = /^\d{4}-\d{2}-\d{2}$/.test(accepted) ? row.candidates.find((c: { publishedAt: string }) => c.publishedAt === accepted) : null;
      if (/^\d{4}/.test(accepted) && !hit) throw new Error(`rank ${rank}: no candidate on ${accepted}`);
      const verdict = hit ? "accepted" : accepted === "uncertain" ? "uncertain" : "none";
      return { rank, uid: row.uid, verdict, publicationId: hit ? hit.id : null, note };
    });
  const reviewedBy = process.argv.includes("--reviewed") ? "remo" : "claude_proposal_pending_remo";
  writeFileSync(ADJ, JSON.stringify({ reviewedBy, rows }, null, 2) + "\n");
  console.log(`wrote ${rows.length} adjudications (${reviewedBy}): ${rows.filter((r) => r.verdict === "accepted").length} accepted, ${rows.filter((r) => r.verdict === "uncertain").length} uncertain, ${rows.filter((r) => r.verdict === "none").length} none`);
}

async function computeRecall() {
  const cfg = loadClassificationConfig();
  if (cfg.tau === null || cfg.tauLow === null) throw new Error("τ not frozen");
  const adj = adjudication.parse(JSON.parse(readFileSync(ADJ, "utf8")));
  const { cohort } = cohortFile.parse(JSON.parse(readFileSync("eval/cohort.json", "utf8")));
  const rows = [];
  for (const a of adj.rows) {
    const round = cohort.find((r) => r.rank === a.rank)!;
    let candidate = false;
    let rulesPositive = false;
    let tier: string | null = null;
    let score: number | null = null;
    let reason = a.verdict === "none" ? "no gazette increase matched" : a.verdict === "uncertain" ? "match uncertain (excluded from hits)" : "";
    if (a.verdict === "accepted") {
      const company = await loadCompany(a.uid, ruleConfigFrom(cfg));
      const c = company.capitalChanges.find((x) => x.publication.id === a.publicationId);
      if (!c) throw new Error(`rank ${a.rank}: matched publication not assembled (history missing?)`);
      candidate = c.rules.candidate;
      rulesPositive = c.rules.rulesPositive;
      if (candidate) {
        const s = await dbClassificationStore.get(c.inputHash, cfg.modelId, cfg.promptVersion);
        if (!s) reason = "not classified yet";
        else {
          score = s.output?.score ?? null;
          tier = tierFor(score, cfg.tau, cfg.tauLow, s.refusal);
        }
      } else reason = `rejected by the pre-filter (${c.rules.rejectReason})`;
    }
    rows.push({ rank: a.rank, company: round.company, announced: round.announced, verdict: a.verdict, candidate, rulesPositive, tier, score, reason });
  }
  const n = rows.length;
  const notClassified = rows.filter((r) => r.reason === "not classified yet").length;
  const result = {
    reviewedBy: adj.reviewedBy,
    cohort: n,
    notClassified,
    preFilter: recall(rows.filter((r) => r.candidate).length, n),
    rulesOnly: recall(rows.filter((r) => r.rulesPositive).length, n),
    rulesPlusClaude: recall(rows.filter((r) => r.tier === "likely_financing").length, n),
    // Secondary figure (decision log #17): likely financing or undecided.
    rulesPlusClaudeIncludingUndecided: recall(rows.filter((r) => r.tier === "likely_financing" || r.tier === "abstain").length, n),
    rows,
  };
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(`${RESULTS}/recall.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
  for (const r of rows.filter((x) => x.tier !== "likely_financing")) console.log(`  miss ${r.rank} ${r.company}: ${r.reason || `tier ${r.tier} (score ${r.score})`}`);
  return result;
}

const [cmd] = process.argv.slice(2);
if (cmd === "adjudicate") adjudicate();
else if (cmd === "recall") await computeRecall();
else if (cmd === "run") {
  if (!existsSync(ADJ)) throw new Error(`${ADJ} missing: adjudicate the cohort first`);
  await computeRecall();
  console.log("precision needs the verified holdout sample (eval/precision-sample.json): not yet drawn");
} else {
  console.error("usage: eval <adjudicate|recall|run>");
  process.exit(1);
}
