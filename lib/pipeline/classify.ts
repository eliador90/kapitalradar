// Classifier (T7, T18): claude-opus-5-5 at low effort on Remo's subscription through headless
// Claude Code (`claude -p`) with an isolated CLAUDE_CONFIG_DIR, behind a backend interface so an
// API-key backend can be added later. Failure modes are distinct (CEO review Section 2):
// malformed JSON → one retry → error; empty → one retry → error; refusal → abstain; cited rule
// ids outside the fired set → rejected and counted. Nothing is swallowed.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifierOutput, type ClassifierOutput, type Tier } from "../domain/schemas";
import type { ClassifierInput } from "./redact";

export const MODEL_ID = "claude-opus-5-5";
export const EFFORT = "low";
export const PROMPT_VERSION = "1";
export const PROMPT_FILE = "prompts/classifier-v1.md";
/** Plan: abort a run beyond this many fresh classifications (cost control). */
export const MAX_CLASSIFICATIONS_PER_RUN = Number(process.env.MAX_CLASSIFICATIONS_PER_RUN ?? 3000);
export const CONCURRENCY = 3;

export const OUTPUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string" },
    citedRuleIds: { type: "array", items: { type: "string" } },
  },
  required: ["score", "rationale", "citedRuleIds"],
  additionalProperties: false,
} as const;

export interface Usage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** API-equivalent cost reported by the CLI (subscription runs are not billed per call). */
  costUsd: number;
}

export interface BackendReply {
  /** The structured output, or null when the model returned none. */
  structured: unknown;
  text: string;
  refusal: boolean;
  usage: Usage;
}

export class UsageLimitError extends Error {}
export class BackendError extends Error {}

export interface ClassifierBackend {
  readonly modelId: string;
  call(systemPrompt: string, userMessage: string, jsonSchema: object): Promise<BackendReply>;
}

// ---- subscription CLI backend --------------------------------------------------------------

/** The real executable: on Windows `claude` is a .cmd shim that needs a shell, so use the .exe. */
export function claudeBinary(): string {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (existsSync(exe)) return exe;
  }
  return "claude";
}

export class ClaudeCliBackend implements ClassifierBackend {
  readonly modelId = MODEL_ID;
  constructor(
    private readonly configDir = resolve(".claude-classifier"),
    /** An empty working directory, so no project instructions load into the session. */
    private readonly cwd = resolve(".data/classifier-cwd"),
    private readonly timeoutMs = 180_000,
  ) {
    if (!existsSync(join(configDir, ".credentials.json"))) throw new BackendError(`no login in ${configDir}: run claude once with CLAUDE_CONFIG_DIR set and /login`);
    mkdirSync(cwd, { recursive: true });
  }

  call(systemPrompt: string, userMessage: string, jsonSchema: object): Promise<BackendReply> {
    const args = [
      "-p",
      "--model", MODEL_ID,
      "--effort", EFFORT,
      "--system-prompt", systemPrompt,
      "--json-schema", JSON.stringify(jsonSchema),
      "--tools", "",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--setting-sources", "",
      "--output-format", "json",
    ];
    return new Promise((done, fail) => {
      // No shell: a shell would mangle the empty "--tools" value and the multi-line prompt.
      const child = spawn(claudeBinary(), args, { cwd: this.cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: this.configDir } });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        fail(new BackendError(`claude -p timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => {
        clearTimeout(timer);
        fail(new BackendError(`could not start claude: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        let j: Record<string, unknown>;
        try {
          j = JSON.parse(out);
        } catch {
          const msg = `${err}\n${out}`.slice(0, 500);
          return fail(/usage limit|rate limit|limit reached|429/i.test(msg) ? new UsageLimitError(msg) : new BackendError(`exit ${code}, no JSON: ${msg}`));
        }
        const text = String(j.result ?? "");
        if (j.is_error) {
          const status = j.api_error_status;
          return fail(status === 429 || /usage limit|limit reached|rate limit/i.test(text) ? new UsageLimitError(text || String(status)) : new BackendError(`claude error ${status ?? ""}: ${text.slice(0, 300)}`));
        }
        const u = (j.usage ?? {}) as Record<string, number>;
        done({
          structured: j.structured_output ?? null,
          text,
          refusal: j.stop_reason === "refusal",
          usage: {
            inputTokens: u.input_tokens ?? 0,
            cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            costUsd: Number(j.total_cost_usd ?? 0),
          },
        });
      });
      // The user message goes over stdin: no argument-length limits, nothing in the process list.
      child.stdin.end(userMessage);
    });
  }
}

export const loadPrompt = (file = PROMPT_FILE) => readFileSync(file, "utf8");
export const totalInputTokens = (u: Usage) => u.inputTokens + u.cacheCreationTokens + u.cacheReadTokens;

// ---- one classification --------------------------------------------------------------------

export type ClassificationError = "malformed_json" | "empty" | "invalid_rule_ids" | "backend";

export interface Classification {
  output: ClassifierOutput | null;
  refusal: boolean;
  error: ClassificationError | null;
  errorDetail: string | null;
  usage: Usage;
  attempts: number;
}

const ZERO: Usage = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0 };
const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd,
});

/** UsageLimitError propagates (the runner stops); everything else becomes a recorded outcome. */
export async function classifyOne(backend: ClassifierBackend, systemPrompt: string, input: ClassifierInput): Promise<Classification> {
  const message = JSON.stringify(input, null, 1);
  const fired = new Set<string>(input.firedRules.map((r) => r.id));
  let usage = ZERO;
  let last: { error: ClassificationError; detail: string } = { error: "empty", detail: "" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reply: BackendReply;
    try {
      reply = await backend.call(systemPrompt, message, OUTPUT_JSON_SCHEMA);
    } catch (e) {
      if (e instanceof UsageLimitError) throw e;
      return { output: null, refusal: false, error: "backend", errorDetail: (e as Error).message, usage, attempts: attempt };
    }
    usage = add(usage, reply.usage);
    if (reply.refusal) return { output: null, refusal: true, error: null, errorDetail: null, usage, attempts: attempt };
    if (reply.structured === null && !reply.text.trim()) {
      last = { error: "empty", detail: "no output" };
      continue;
    }
    const parsed = classifierOutput.safeParse(reply.structured ?? safeJson(reply.text));
    if (!parsed.success) {
      last = { error: "malformed_json", detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
      continue;
    }
    const outside = parsed.data.citedRuleIds.filter((id) => !fired.has(id));
    // Plan eng Q3: a citation outside the fired set rejects the assessment; no retry.
    if (outside.length) return { output: null, refusal: false, error: "invalid_rule_ids", errorDetail: `cited ${outside.join(", ")}`, usage, attempts: attempt };
    return { output: parsed.data, refusal: false, error: null, errorDetail: null, usage, attempts: attempt };
  }
  return { output: null, refusal: false, error: last.error, errorDetail: last.detail, usage, attempts: 2 };
}

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

/**
 * The pre-stated threshold rule (decision log #17, advisors' counsel): τ = 20th percentile of dev
 * positive scores rounded down to 0.05; τ_low = highest dev negative + 0.05 rounded up to 0.05;
 * τ is raised in 0.05 steps until dev precision at τ is 1.0. Nothing is optimized on dev.
 */
export function freezeThresholds(positiveScores: readonly number[], negativeScores: readonly number[]): { tau: number; tauLow: number } {
  if (!positiveScores.length || !negativeScores.length) throw new Error("freezeThresholds needs dev positives and negatives");
  const pos = [...positiveScores].sort((a, b) => a - b);
  const q = pos[Math.floor(0.2 * (pos.length - 1))]!;
  const round = (x: number) => Math.round(x * 100) / 100;
  let tau = round(Math.floor(q / 0.05 + 1e-9) * 0.05);
  const maxNeg = Math.max(...negativeScores);
  while (negativeScores.some((s) => s >= tau) && tau < 1) tau = round(tau + 0.05);
  const tauLow = Math.min(round(Math.ceil((maxNeg + 0.05) / 0.05 - 1e-9) * 0.05), tau);
  return { tau, tauLow };
}

/** Plan tier mapping: ≥ τ likely financing; τ_low ≤ score < τ abstain; below τ_low capital increased. */
export function tierFor(score: number | null, tau: number, tauLow: number, refusal = false): Tier {
  if (refusal || score === null) return "abstain";
  return score >= tau ? "likely_financing" : score >= tauLow ? "abstain" : "capital_increased";
}

// ---- runner (T18) --------------------------------------------------------------------------

export interface StoredClassification {
  inputHash: string;
  modelId: string;
  promptVersion: string;
  output: ClassifierOutput | null;
  refusal: boolean;
  error: ClassificationError | null;
  usage: Usage;
}

export interface ClassificationStore {
  get(inputHash: string, modelId: string, promptVersion: string): Promise<StoredClassification | null>;
  put(c: StoredClassification): Promise<void>;
}

export interface RunStats {
  items: number;
  cached: number;
  classified: number;
  errors: Record<string, number>;
  refusals: number;
  stoppedForUsageLimit: boolean;
  stoppedAtCap: boolean;
  usage: Usage;
}

export async function runClassifications(
  items: readonly { inputHash: string; input: ClassifierInput }[],
  backend: ClassifierBackend,
  store: ClassificationStore,
  opts: { systemPrompt: string; promptVersion?: string; cap?: number; concurrency?: number; log?: (s: string) => void },
): Promise<RunStats> {
  const promptVersion = opts.promptVersion ?? PROMPT_VERSION;
  const cap = opts.cap ?? MAX_CLASSIFICATIONS_PER_RUN;
  const log = opts.log ?? console.log;
  const stats: RunStats = { items: items.length, cached: 0, classified: 0, errors: {}, refusals: 0, stoppedForUsageLimit: false, stoppedAtCap: false, usage: ZERO };
  let next = 0;
  let started = 0;
  const stop = () => stats.stoppedForUsageLimit || stats.stoppedAtCap;
  await Promise.all(
    Array.from({ length: opts.concurrency ?? CONCURRENCY }, async () => {
      while (next < items.length && !stop()) {
        const item = items[next++]!;
        if (await store.get(item.inputHash, backend.modelId, promptVersion)) {
          stats.cached++; // idempotency: never paid for twice
          continue;
        }
        if (started >= cap) {
          stats.stoppedAtCap = true;
          log(`stopping: MAX_CLASSIFICATIONS_PER_RUN (${cap}) reached`);
          break;
        }
        started++;
        try {
          const c = await classifyOne(backend, opts.systemPrompt, item.input);
          stats.usage = add(stats.usage, c.usage);
          if (c.error) stats.errors[c.error] = (stats.errors[c.error] ?? 0) + 1;
          if (c.refusal) stats.refusals++;
          if (c.error) console.error(`[classify] ${item.inputHash.slice(0, 12)} ${c.error}: ${c.errorDetail}`);
          // Backend failures are not stored, so a rerun retries them; outcomes from the model are.
          if (c.error !== "backend") await store.put({ inputHash: item.inputHash, modelId: backend.modelId, promptVersion, output: c.output, refusal: c.refusal, error: c.error, usage: c.usage });
          stats.classified++;
        } catch (e) {
          if (!(e instanceof UsageLimitError)) throw e;
          stats.stoppedForUsageLimit = true;
          log(`stopping cleanly: subscription usage limit (${e.message.slice(0, 120)}); rerun later to resume`);
        }
      }
    }),
  );
  return stats;
}
