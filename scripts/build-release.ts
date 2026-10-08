// Release build (T8). Run after `npm run ingest` and `npm run history` for the window.
//
//   npm run build-release -- --release r1 --dry-run   derive rows and check gates, write nothing
//   npm run build-release -- --release r1             write the release; flip the pointer if the gates pass
//   npm run build-release -- --rollback r0            re-point current_release to an earlier ready release
import { existsSync, readFileSync } from "node:fs";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { releaseEval } from "../lib/domain/eval-result";
import { isCapitalIncrease } from "../lib/domain/events";
import { matchConfirmations } from "../lib/pipeline/confirmations";
import { articlesOf, readArticleCache } from "../lib/pipeline/confirmations-cache";
import { classifications, publications } from "../db/schema";
import { BACKFILL_START, listCandidateUids, loadCompany, type CompanyBundle } from "../lib/pipeline/candidates";
import type { StoredClassification } from "../lib/pipeline/classify";
import { loadClassificationConfig, releaseConfigFrom, ruleConfigFrom } from "../lib/pipeline/config";
import { PARSER_VERSION } from "../lib/pipeline/parse";
import { RULES_FINGERPRINT } from "../lib/domain/rule-catalog";
import { buildRelease, deriveRows, missingGazetteDays, rollback, type ConfirmationRow } from "../lib/pipeline/release";
import { dbReleaseRepo } from "../lib/pipeline/release-repo";

const EVAL_RESULT = "eval/results/release-eval.json";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const cfg = loadClassificationConfig();
if (arg("rollback")) {
  await rollback(dbReleaseRepo(cfg.modelId, cfg.promptVersion), arg("rollback")!);
  console.log(`current_release → ${arg("rollback")}`);
  process.exit(0);
}
// "auto": the next free id (daily job); ids are never reused, failed builds included.
const nextReleaseId = async () => {
  const ids = (await db().execute(sql`select id from releases`)).rows.map((r) => Number(String((r as { id: string }).id).slice(1))).filter(Number.isInteger);
  return `r${Math.max(0, ...ids) + 1}`;
};
const releaseId = arg("release") === "auto" ? await nextReleaseId() : arg("release");
if (!releaseId || !/^r\d+$/.test(releaseId)) {
  console.error("usage: build-release --release r<N>|auto [--snapshot YYYY-MM-DD] [--dry-run] | --rollback r<N>");
  process.exit(1);
}
const dryRun = args.includes("--dry-run");

// Snapshot: the last stored HR02 publication day (releases.snapshot_date, eng delta A14).
const maxDay = ((await db().execute(sql`select max(published_at)::text as "maxDay" from publications where sub_rubric = 'HR02'`)).rows[0] as { maxDay: string | null } | undefined)?.maxDay;
const snapshotDate = arg("snapshot") ?? maxDay;
if (!snapshotDate) throw new Error("no HR02 publications stored: run the ingest first");

const uids = await listCandidateUids(BACKFILL_START);
console.log(`snapshot ${snapshotDate}; ${uids.length} candidate companies`);
const ruleConfig = ruleConfigFrom(cfg);
const companies: CompanyBundle[] = [];
let next = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < uids.length) {
      const uid = uids[next++]!;
      companies.push(await loadCompany(uid, ruleConfig));
      if (companies.length % 500 === 0) console.log(`loaded ${companies.length}/${uids.length}`);
    }
  }),
);

const stored = new Map<string, StoredClassification>();
for (const r of await db().select().from(classifications).where(and(eq(classifications.modelId, cfg.modelId), eq(classifications.promptVersion, cfg.promptVersion)))) {
  const refusal = r.error === "refusal";
  stored.set(r.inputHash, {
    inputHash: r.inputHash,
    modelId: r.modelId,
    promptVersion: r.promptVersion,
    output: r.score === null || r.error ? null : { score: r.score, rationale: r.rationale ?? "", citedRuleIds: r.citedRuleIds },
    refusal,
    error: refusal ? null : (r.error as StoredClassification["error"]),
    usage: { inputTokens: r.inputTokens ?? 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: r.outputTokens ?? 0, costUsd: 0 },
  });
}

const days = new Set(
  (await db().selectDistinct({ d: publications.publishedAt }).from(publications).where(and(eq(publications.subRubric, "HR02"), gte(publications.publishedAt, BACKFILL_START), lte(publications.publishedAt, snapshotDate)))).map((r) => r.d),
);
const confirmationRow = z.object({
  companyUid: z.string(),
  // Rendered as a link: https only (no javascript:, data: or relative URLs).
  sourceUrl: z.url({ protocol: /^https$/ }),
  publishedAt: z.string(),
  statedAmount: z.string().nullable(),
  statedCurrency: z.string().nullable(),
  stage: z.string().nullable(),
  matchMethod: z.string(),
  matchConfidence: z.enum(["high", "low"]),
  eventMatch: z.enum(["accepted", "rejected", "uncertain"]),
  reviewedAt: z.string().nullable(),
  matchedPublicationId: z.string().nullable(),
});
// Confirmations come from startupticker financing news (crawled by `npm run confirmations`),
// matched to our companies here so they always use this build's company data.
const confirmations: ConfirmationRow[] = z.array(confirmationRow).parse(
  matchConfirmations(
    articlesOf(readArticleCache()),
    companies.map((c) => ({
      uid: c.uid,
      names: c.names,
      increases: c.capitalChanges.filter((x) => isCapitalIncrease(x.event.payload)).map((x) => ({ publicationId: x.publication.id, publishedAt: x.publication.publishedAt })),
    })),
  ),
);
console.log(`confirmations: ${confirmations.length} (${confirmations.filter((c) => c.matchConfidence === "high").length} high confidence)`);
// Validated against the one schema the pages read: a malformed file stops the build here.
const parsedEval = existsSync(EVAL_RESULT) ? releaseEval.parse(JSON.parse(readFileSync(EVAL_RESULT, "utf8"))) : null;
// Unreviewed labels never ship: a provisional artifact counts as no eval (the gate fails). Nor
// does an eval of another system (parser, model, prompt or thresholds): it measured something else.
const s = parsedEval?.system;
const sameSystem = !!s && s.parserVersion === PARSER_VERSION && s.modelId === cfg.modelId && s.promptVersion === cfg.promptVersion && s.tau === cfg.tau && s.tauLow === cfg.tauLow && s.rulesThreshold === cfg.rulesThreshold && s.rules === RULES_FINGERPRINT;
if (parsedEval?.provisional) console.log(`${EVAL_RESULT} is provisional (labels await review): treated as missing`);
else if (parsedEval && !sameSystem) console.log(`${EVAL_RESULT} measured another system (${JSON.stringify(s ?? "no system recorded")}): treated as missing`);
const evalResult = parsedEval?.provisional || !sameSystem ? null : parsedEval;

if (dryRun) {
  const tau = cfg.tau ?? 0.5;
  const derived = deriveRows({ companies, classification: (h) => stored.get(h) ?? null, config: { rules: [], rulesThreshold: cfg.rulesThreshold, tau, tauLow: cfg.tauLow ?? tau - 0.2, modelId: cfg.modelId, promptVersion: cfg.promptVersion, parserVersion: PARSER_VERSION }, snapshotDate, backfillStart: BACKFILL_START });
  const tiers = derived.assessments.reduce<Record<string, number>>((a, x) => ((a[x.tier] = (a[x.tier] ?? 0) + 1), a), {});
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        tauFrozen: cfg.tau !== null,
        events: derived.events.length,
        assessments: derived.assessments.length,
        candidates: derived.candidates,
        unclassifiedOrErrors: derived.classifierErrors,
        parseFailures: derived.parseFailures,
        evidenceViolations: derived.evidenceViolations,
        missingGazetteDays: missingGazetteDays(days, BACKFILL_START, snapshotDate),
        tiers,
        confirmations: confirmations.length,
        evalPresent: evalResult !== null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const result = await buildRelease(
  {
    releaseId,
    snapshotDate,
    backfillStart: BACKFILL_START,
    config: releaseConfigFrom(cfg, PARSER_VERSION),
    companies,
    classification: (h) => stored.get(h) ?? null,
    confirmations,
    daysWithEntries: days,
    evalResult,
  },
  dbReleaseRepo(cfg.modelId, cfg.promptVersion),
);
console.log(JSON.stringify(result, null, 2));
if (!result.activated) process.exitCode = 2;
