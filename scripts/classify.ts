// Classifier runs (T7) on Remo's subscription via `claude -p` with the isolated config.
//
//   npm run classify -- probe             context check: nothing beyond the prompt enters the session
//   npm run classify -- measure --n 100   usage on N items (dev set first, then seeded non-cohort candidates)
//   npm run classify -- dev-report [--freeze]  τ/τ_low by the pre-stated rule, model-memory test
//   npm run classify -- identify          identifiability probe on the dev items
//   npm run classify -- backfill          all candidates of companies with complete history (idempotent)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { db } from "../db/client";
import { checkpoints, companySources } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { cohortUids } from "../eval/lib/ledger";
import { seededShuffle } from "../eval/lib/seeded";
import { BACKFILL_START, loadCompany, type CapitalCandidate } from "../lib/pipeline/candidates";
import { dbClassificationStore } from "../lib/pipeline/classification-store";
import { ClaudeCliBackend, classifyOne, freezeThresholds, loadPrompt, PROMPT_VERSION, runClassifications, tierFor, totalInputTokens, type Usage } from "../lib/pipeline/classify";
import { CONFIG_FILE, loadClassificationConfig, ruleConfigFrom } from "../lib/pipeline/config";
import { inputHash, type ClassifierInput } from "../lib/pipeline/redact";
import { fitThreshold } from "../lib/pipeline/rules";

const OUT = "eval/classifier";
const SAMPLE_SEED = 1906202601; // fixed for the usage sample
/** Measured baseline ~1'550 input tokens for a one-line system prompt; the prompt adds ~700. */
const CONTEXT_CEILING = 4_000;

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const write = (file: string, data: unknown) => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${file}`, JSON.stringify(data, null, 2) + "\n");
};

const devRows = z.object({ rows: z.array(z.object({ id: z.string(), source: z.string(), positive: z.boolean(), unknown: z.boolean() })) });

/** Dev items with their assembled candidate (from the rules dev report). */
async function devCandidates(): Promise<{ id: string; source: string; positive: boolean; unknown: boolean; uid: string; c: CapitalCandidate }[]> {
  const report = devRows.parse(JSON.parse(readFileSync("eval/dev/rules-dev-report.json", "utf8")));
  const labels = [
    ...JSON.parse(readFileSync("eval/dev/assignment-labels.json", "utf8")).labels,
    ...JSON.parse(readFileSync("eval/dev/spike-labels.json", "utf8")).labels,
  ] as { id: string; uid: string }[];
  const out = [];
  for (const r of report.rows) {
    const uid = labels.find((l) => l.id === r.id)!.uid;
    const company = await loadCompany(uid);
    const c = company.capitalChanges.find((x) => x.publication.id === r.id);
    if (!c) throw new Error(`dev item ${r.id} not assembled`);
    out.push({ ...r, uid, c });
  }
  return out;
}

async function probe() {
  const backend = new ClaudeCliBackend();
  const [item] = await devCandidates();
  const t0 = Date.now();
  const c = await classifyOne(backend, loadPrompt(), item!.c.input);
  const total = totalInputTokens(c.usage);
  const result = { totalInputTokens: total, ceiling: CONTEXT_CEILING, ok: total <= CONTEXT_CEILING, ms: Date.now() - t0, error: c.error, score: c.output?.score ?? null };
  console.log(result);
  write("context-probe.json", { ...result, at: new Date().toISOString() });
  if (!result.ok) {
    console.error("context check FAILED: more than the classifier prompt entered the session");
    process.exitCode = 2;
  }
}

async function measure() {
  const n = Number(arg("n") ?? 100);
  const dev = await devCandidates();
  const items: { inputHash: string; input: ClassifierInput }[] = dev.filter((d) => d.c.rules.candidate).map((d) => ({ inputHash: d.c.inputHash, input: d.c.input }));
  // Fill up with seeded non-cohort candidates whose history is already fetched.
  const sealed = cohortUids();
  const devUids = new Set(dev.map((d) => d.uid));
  const uids = seededShuffle((await db().select({ uid: companySources.companyUid }).from(companySources)).map((r) => r.uid).sort(), SAMPLE_SEED).filter((u) => !sealed.has(u) && !devUids.has(u));
  for (const uid of uids) {
    if (items.length >= n) break;
    const company = await loadCompany(uid);
    const cand = company.capitalChanges.find((c) => c.rules.candidate && c.publication.publishedAt >= BACKFILL_START);
    if (cand) items.push({ inputHash: cand.inputHash, input: cand.input });
  }
  const t0 = Date.now();
  const stats = await runClassifications(items.slice(0, n), new ClaudeCliBackend(), dbClassificationStore, { systemPrompt: loadPrompt() });
  const ms = Date.now() - t0;
  const fresh = stats.classified || 1;
  const per = (u: Usage) => ({ input: Math.round(totalInputTokens(u) / fresh), output: Math.round(u.outputTokens / fresh), apiEquivalentUsd: +(u.costUsd / fresh).toFixed(4) });
  const result = { ...stats, sampled: items.length, wallClockMinutes: +(ms / 60000).toFixed(1), perClassification: per(stats.usage), apiEquivalentUsdPer100: +((stats.usage.costUsd / fresh) * 100).toFixed(2) };
  console.log(JSON.stringify(result, null, 2));
  write("usage-measure.json", { ...result, at: new Date().toISOString(), promptVersion: PROMPT_VERSION });
}

async function devReport() {
  const dev = await devCandidates();
  const store = dbClassificationStore;
  const backend = new ClaudeCliBackend();
  const prompt = loadPrompt();
  const rows = [];
  for (const d of dev) {
    const s = d.c.rules.candidate ? await store.get(d.c.inputHash, backend.modelId, PROMPT_VERSION) : null;
    rows.push({ id: d.id, source: d.source, positive: d.positive, unknown: d.unknown, candidate: d.c.rules.candidate, score: s?.output?.score ?? null, refusal: s?.refusal ?? false, error: s?.error ?? null });
  }
  const scored = rows.filter((r) => !r.unknown && r.score !== null);
  const fit = fitThreshold(scored.map((r) => ({ score: r.score!, positive: r.positive, candidate: r.candidate })));
  // The pre-stated rule, not the max-F1 edge (decision log #17).
  const { tau, tauLow } = freezeThresholds(
    scored.filter((r) => r.positive).map((r) => r.score!),
    scored.filter((r) => !r.positive).map((r) => r.score!),
  );

  // Model-memory test: announced dev rounds scored with and without the company's identity.
  const memory = [];
  for (const d of dev.filter((x) => x.source === "spike" && x.c.rules.candidate)) {
    const named: ClassifierInput & { companyName: string } = { ...d.c.input, companyName: (await loadCompany(d.uid)).names[0] ?? "", purpose: d.c.publication.purpose };
    const hash = inputHash(named);
    let s = await store.get(hash, backend.modelId, `${PROMPT_VERSION}-named`);
    if (!s) {
      const c = await classifyOne(backend, prompt, named);
      s = { inputHash: hash, modelId: backend.modelId, promptVersion: `${PROMPT_VERSION}-named`, output: c.output, refusal: c.refusal, error: c.error, usage: c.usage };
      await store.put(s);
    }
    const base = rows.find((r) => r.id === d.id)!.score;
    if (base !== null && s.output) memory.push({ id: d.id, redacted: base, named: s.output.score, flip: tierFor(base, tau, tauLow) !== tierFor(s.output.score, tau, tauLow) });
  }
  const meanDelta = memory.length ? memory.reduce((a, m) => a + Math.abs(m.named - m.redacted), 0) / memory.length : null;
  const flips = memory.filter((m) => m.flip).length;

  const report = {
    note: "Dev data only; never reported as precision or recall. τ frozen from this run.",
    tau,
    tauLow,
    fit,
    rows,
    memoryTest: { n: memory.length, meanAbsDelta: meanDelta, tierFlips: flips, pass: meanDelta !== null && meanDelta < 0.05 && flips <= 1, items: memory },
  };
  write("dev-report.json", report);
  console.log(JSON.stringify({ ...report, rows: undefined, memoryTest: { ...report.memoryTest, items: undefined } }, null, 2));
  if (args.includes("--freeze")) {
    const cfg = loadClassificationConfig();
    if (cfg.frozenAt) throw new Error(`τ already frozen at ${cfg.frozenAt}: changing it needs a new holdout`);
    writeFileSync(CONFIG_FILE, JSON.stringify({ note: "Frozen classification settings (decision log #11, #17). Changing tau/tauLow after the holdout is seen requires a new holdout.", ...cfg, tau, tauLow, frozenAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`frozen τ=${tau} τ_low=${tauLow} → ${CONFIG_FILE}`);
  }
}

async function backfill() {
  // Every pre-filter candidate of companies whose history fetch is complete (inputs depend on it).
  const done = new Set((await db().select({ uid: checkpoints.itemKey }).from(checkpoints).where(and(eq(checkpoints.job, `history:${arg("run") ?? "2026-10-06"}`), eq(checkpoints.status, "done")))).map((r) => r.uid));
  const ruleConfig = ruleConfigFrom(loadClassificationConfig());
  const items: { inputHash: string; input: ClassifierInput }[] = [];
  for (const uid of [...done].sort()) {
    for (const c of (await loadCompany(uid, ruleConfig)).capitalChanges) {
      if (c.rules.candidate && c.publication.publishedAt >= BACKFILL_START) items.push({ inputHash: c.inputHash, input: c.input });
    }
  }
  console.log(`${done.size} companies with complete history → ${items.length} candidates`);
  const stats = await runClassifications(items, new ClaudeCliBackend(), dbClassificationStore, { systemPrompt: loadPrompt(), log: console.log });
  console.log(JSON.stringify({ ...stats, apiEquivalentUsd: +stats.usage.costUsd.toFixed(2) }, null, 2));
  if (stats.stoppedForUsageLimit) process.exitCode = 3;
}

async function identify() {
  // Identifiability probe (eng T2b): can the model name the company from the redacted input?
  const dev = await devCandidates();
  const backend = new ClaudeCliBackend();
  const system = "You will see a redacted description of a Swiss company's capital increase. If you can identify the company, give its name; otherwise answer unknown. Reply as JSON.";
  const schema = { type: "object", properties: { guess: { type: "string" } }, required: ["guess"], additionalProperties: false };
  let hits = 0;
  const items = [];
  for (const d of dev) {
    const names = (await loadCompany(d.uid)).names;
    const r = await backend.call(system, JSON.stringify(d.c.input), schema);
    const guess = String((r.structured as { guess?: string } | null)?.guess ?? "unknown");
    const stems = names.map((n) => n.replace(/\b(AG|SA|Ltd|GmbH|Sàrl|Holding)\b/gi, "").trim().toLowerCase()).filter((s) => s.length >= 3);
    const hit = guess.toLowerCase() !== "unknown" && stems.some((s) => guess.toLowerCase().includes(s) || s.includes(guess.toLowerCase()));
    if (hit) hits++;
    items.push({ id: d.id, hit });
  }
  const result = { n: dev.length, hits, hitRate: hits / dev.length, items };
  write("identifiability.json", result);
  console.log({ n: result.n, hits, hitRate: result.hitRate });
}

const [cmd] = args;
const commands: Record<string, () => Promise<void>> = { probe, measure, "dev-report": devReport, identify, backfill };
const run = commands[cmd ?? ""];
if (!run) {
  console.error(`usage: classify <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
await run();
