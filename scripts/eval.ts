// Release evaluation (T9). Reads the adjudicated cohort, classifications and the frozen config;
// never the `confirmations` table (plan: the eval-isolation test enforces it).
//
//   npm run eval -- adjudicate   .data/cohort/adjudication.md → eval/cohort-adjudication.json
//   npm run eval -- recall       recall per system + pre-filter ceiling → eval/results/recall.json
//   npm run eval -- precision-draw --release rN   seeded holdout-positive sample → eval/precision-sample.json
//   npm run eval -- run --release rN              full release eval artifact → eval/results/release-eval.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { addToLedger, sealedUids, today } from "../eval/lib/ledger";
import { allocate, drawSample, STRATA, stratumOf, systemStrata, type Stratum } from "../eval/lib/precision";
import { cohortFile } from "../eval/lib/schemas";
import { seededShuffle } from "../eval/lib/seeded";
import { evalLine, releaseEval, type ReleaseEval } from "../lib/domain/eval-result";
import { recall, weightedPrecision } from "../lib/domain/metrics";
import type { Tier } from "../lib/domain/schemas";
import { publicationUrl } from "../lib/domain/shab-link";
import { isClassifierPositive } from "../lib/domain/status";
import { PARSER_VERSION } from "../lib/pipeline/parse";
import { RULES_FINGERPRINT } from "../lib/domain/rule-catalog";
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

const PRECISION_SAMPLE = "eval/precision-sample.json";
const PRECISION_VERDICTS = "eval/precision-verdicts.json";
const PRECISION_SEED = 20261007;
const KNOWN_ISSUES = "eval/known-issues.json";
const REJECTION_SAMPLE = 12;

const precisionSample = z.object({
  release: z.string(),
  seed: z.number(),
  drawnAt: z.string(),
  populations: z.object({ both: z.number(), rules_only: z.number(), claude_only: z.number() }),
  allocation: z.object({ both: z.number(), rules_only: z.number(), claude_only: z.number() }),
  items: z.array(z.object({ key: z.string(), uid: z.string(), company: z.string(), publishedAt: z.string(), publicationId: z.string(), stratum: z.enum(STRATA) })),
});
const precisionVerdicts = z.object({
  reviewedBy: z.string(),
  rows: z.array(z.object({ key: z.string(), verdict: z.enum(["verified", "refuted", "unverifiable"]), source: z.string().nullable(), note: z.string() })),
});

/** Every in-window capital increase of a release with both systems' calls (holdout filter applied by callers). */
async function releaseIncreases(releaseId: string) {
  const rows = await db().execute(sql`
    select e.id as key, e.company_uid as uid, e.published_at::text as "publishedAt", e.publication_id as "publicationId",
           a.rules_positive as "rulesPositive", a.tier, a.reject_reason as "rejectReason", c.score,
           (select n.name from company_names n where n.release_id = e.release_id and n.company_uid = e.company_uid and n.published_at <= e.published_at order by n.published_at desc limit 1) as company
    from assessments a join events e on e.id = a.event_id left join classifications c on c.id = a.classification_id
    where a.release_id = ${releaseId}`);
  return rows.rows as { key: string; uid: string; publishedAt: string; publicationId: string; rulesPositive: boolean; tier: string; rejectReason: string | null; score: number | null; company: string }[];
}

async function precisionDraw(releaseId: string) {
  if (existsSync(PRECISION_SAMPLE)) throw new Error(`${PRECISION_SAMPLE} exists: the sample is drawn once (pre-registered seed ${PRECISION_SEED})`);
  const sealed = sealedUids({ includeLedger: true });
  const positives = (await releaseIncreases(releaseId))
    .filter((r) => !sealed.has(r.uid))
    .map((r) => ({ ...r, stratum: stratumOf(r.rulesPositive, isClassifierPositive(r.tier as Tier)) }))
    .filter((r): r is typeof r & { stratum: Stratum } => r.stratum !== null);
  const populations = { both: 0, rules_only: 0, claude_only: 0 };
  for (const p of positives) populations[p.stratum]++;
  const allocation = allocate(populations);
  const items = drawSample(positives, allocation, PRECISION_SEED).map(({ key, uid, company, publishedAt, publicationId, stratum }) => ({ key, uid, company, publishedAt, publicationId, stratum }));
  writeFileSync(PRECISION_SAMPLE, JSON.stringify({ release: releaseId, seed: PRECISION_SEED, drawnAt: new Date().toISOString(), populations, allocation, items }, null, 2) + "\n");
  console.log(`holdout positives ${JSON.stringify(populations)} → sample ${JSON.stringify(allocation)} (${items.length} items) → ${PRECISION_SAMPLE}`);
  // Researching a sampled company is an inspection: it leaves the holdout for later draws (eng V4).
  console.log(`added ${addToLedger(items.map((i) => ({ uid: i.uid, company: i.company })), "precision")} companies to the inspected ledger`);
  mkdirSync(".data/precision", { recursive: true });
  const sheet = items.map((i, n) => `## ${n + 1}. ${i.company} (${i.uid})\n- key: ${i.key}\n- stratum: ${i.stratum}\n- SHAB published ${i.publishedAt}: ${publicationUrl(i.publicationId)}\n- verdict: \n- source: \n- note: \n`);
  writeFileSync(".data/precision/sheet.md", `# Precision sample (${releaseId}, seed ${PRECISION_SEED})\n\nverified = outside evidence of new financing at this step; refuted = evidence it was not; unverifiable = no evidence either way.\n\n${sheet.join("\n")}`);
  console.log("research sheet → .data/precision/sheet.md");
}

const REJECT_TEXT: Record<string, string> = {
  not_ag: "not an AG",
  restructuring_pair: "capital reduced and re-increased in one entry",
  capital_reduction: "capital reduction",
  not_increase: "no increase of nominal capital",
};

async function run(releaseId: string) {
  if (!existsSync(ADJ)) throw new Error(`${ADJ} missing: adjudicate the cohort first`);
  const cfg = loadClassificationConfig();
  const rec = await computeRecall();
  let provisional = (JSON.parse(readFileSync(ADJ, "utf8")) as { reviewedBy: string }).reviewedBy !== "remo";
  let rulesPrecision = null;
  let claudePrecision = null;
  if (existsSync(PRECISION_VERDICTS)) {
    const sample = precisionSample.parse(JSON.parse(readFileSync(PRECISION_SAMPLE, "utf8")));
    const verdicts = precisionVerdicts.parse(JSON.parse(readFileSync(PRECISION_VERDICTS, "utf8")));
    if (verdicts.reviewedBy !== "remo") provisional = true;
    const byKey = new Map(verdicts.rows.map((v) => [v.key, v.verdict]));
    const missing = sample.items.filter((i) => !byKey.has(i.key));
    if (missing.length) throw new Error(`${missing.length} sampled items have no verdict`);
    const joined = sample.items.map((i) => ({ stratum: i.stratum, verdict: byKey.get(i.key)! }));
    const asSchema = (w: ReturnType<typeof weightedPrecision>) => ({ lo: w.interval.lo, hi: w.interval.hi, estimateLo: w.estimate.lo, estimateHi: w.estimate.hi, n: w.n });
    rulesPrecision = asSchema(weightedPrecision(systemStrata(sample.populations, joined, "rules")));
    claudePrecision = asSchema(weightedPrecision(systemStrata(sample.populations, joined, "claude")));
  } else console.log(`precision: ${PRECISION_VERDICTS} missing, reported as not measured`);
  if (provisional) console.log("PROVISIONAL: adjudication or precision verdicts not yet reviewed by Remo; build-release will refuse this artifact");

  const sealed = sealedUids({ includeLedger: true });
  const rejected = (await releaseIncreases(releaseId)).filter((r) => !sealed.has(r.uid) && !r.rulesPositive && !isClassifierPositive(r.tier as Tier));
  const rejections = seededShuffle(rejected.sort((a, b) => a.key.localeCompare(b.key)), PRECISION_SEED)
    .slice(0, REJECTION_SAMPLE)
    .map((r) => ({
      company: r.company,
      publishedAt: r.publishedAt,
      reason: r.rejectReason
        ? `Pre-filter: ${REJECT_TEXT[r.rejectReason] ?? r.rejectReason}`
        : r.score !== null
          ? `Classifier score ${r.score.toFixed(2)}, below the ${r.tier === "abstain" ? "likely-financing" : "undecided"} threshold (${(r.tier === "abstain" ? cfg.tau! : cfg.tauLow!).toFixed(2)}); rules score below ${cfg.rulesThreshold.toFixed(1)}`
          : "Not classified",
    }))
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

  const result: ReleaseEval = releaseEval.parse({
    evaluatedOn: today(),
    provisional,
    system: { parserVersion: PARSER_VERSION, modelId: cfg.modelId, promptVersion: cfg.promptVersion, tau: cfg.tau!, tauLow: cfg.tauLow!, rulesThreshold: cfg.rulesThreshold, rules: RULES_FINGERPRINT },
    cohortSize: rec.cohort,
    systems: {
      rulesPlusClaude: { precision: claudePrecision, recall: { hits: rec.rulesPlusClaude.detected, n: rec.cohort } },
      rulesOnly: { precision: rulesPrecision, recall: { hits: rec.rulesOnly.detected, n: rec.cohort } },
    },
    recallIncludingUndecided: { hits: rec.rulesPlusClaudeIncludingUndecided.detected, n: rec.cohort },
    misses: rec.rows.filter((r) => r.tier !== "likely_financing").map((r) => ({ company: r.company, announced: r.announced, reason: r.reason || `classifier score ${r.score?.toFixed(2) ?? "—"} (${r.tier === "abstain" ? "undecided" : "below threshold"})` })),
    rejections,
    confirmationSource: "Confirmed rounds come from hand-checked announcements.",
    knownIssues: existsSync(KNOWN_ISSUES) ? z.object({ issues: z.array(z.string()) }).parse(JSON.parse(readFileSync(KNOWN_ISSUES, "utf8"))).issues : [],
  });
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(`${RESULTS}/release-eval.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(`release eval → ${RESULTS}/release-eval.json`);
  console.log(evalLine(result));
}

const [cmd] = process.argv.slice(2);
const releaseArg = () => {
  const i = process.argv.indexOf("--release");
  const r = i >= 0 ? process.argv[i + 1] : undefined;
  if (!r || !/^r\d+$/.test(r)) throw new Error("--release r<N> required: the built (not necessarily activated) release to evaluate");
  return r;
};
if (cmd === "adjudicate") adjudicate();
else if (cmd === "recall") await computeRecall();
else if (cmd === "precision-draw") await precisionDraw(releaseArg());
else if (cmd === "run") await run(releaseArg());
else {
  console.error("usage: eval <adjudicate|recall|precision-draw --release rN|run --release rN>");
  process.exit(1);
}
