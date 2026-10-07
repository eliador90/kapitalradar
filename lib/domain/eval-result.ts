// The release evaluation artifact (eval/results/release-eval.json, stored as releases.eval_result).
// One schema for the writer (scripts/eval.ts run) and every surface that shows it: the eval line,
// /methodology and /misses. Release-level metadata only: it never rewinds (design J2).
import { z } from "zod";
import { formatDate } from "./format";
import { isoDate } from "./schemas";

const precision = z.object({
  /** Wilson 95% interval bounds on the weighted precision. */
  lo: z.number().min(0).max(1),
  hi: z.number().min(0).max(1),
  /** Point estimate with unverifiable labels counted as false (low) and as true (high). */
  estimateLo: z.number().min(0).max(1),
  estimateHi: z.number().min(0).max(1),
  /** This system's sample size. */
  n: z.number().int().nonnegative(),
});
const recall = z.object({ hits: z.number().int().nonnegative(), n: z.number().int().nonnegative() });
const system = z.object({ precision: precision.nullable(), recall });

export const releaseEval = z.object({
  evaluatedOn: isoDate,
  /** True while the cohort adjudication or the precision verdicts await Remo's review: never ships. */
  provisional: z.boolean(),
  /** The system this eval measured; build-release only accepts an eval of the system it builds. Absent on the v1 artifact. */
  system: z.object({ parserVersion: z.string(), modelId: z.string(), promptVersion: z.string(), tau: z.number(), tauLow: z.number(), rulesThreshold: z.number(), rules: z.string().optional() }).optional(),
  cohortSize: z.number().int().nonnegative(),
  systems: z.object({ rulesPlusClaude: system, rulesOnly: system }),
  /** Secondary figure (decision log #17): likely financing or undecided counts as a hit. */
  recallIncludingUndecided: recall.nullable(),
  /** Recall-cohort rounds the classifier missed, with the reason. Company names only. */
  misses: z.array(z.object({ company: z.string(), announced: isoDate, reason: z.string() })),
  /** Random sample of pre-filter or classifier rejections with reasons. */
  rejections: z.array(z.object({ company: z.string(), publishedAt: isoDate, reason: z.string() })),
  /** Confirmed rounds come from hand-checked announcements (OQ4). */
  confirmationSource: z.string(),
  /** Known defects of the evaluated system, disclosed on /methodology (shipped as evaluated, fixed in the next release). */
  knownIssues: z.array(z.string()),
});
export type ReleaseEval = z.infer<typeof releaseEval>;

export const parseReleaseEval = (raw: unknown): ReleaseEval | null => {
  if (raw === null || raw === undefined) return null; // no eval attached (a release never activates without one)
  const r = releaseEval.safeParse(raw);
  if (!r.success) console.error(`[eval-result] release eval does not match the schema: ${r.error.message}`);
  return r.success ? r.data : null;
};

export const pct = (x: number) => `${Math.round(x * 100)}%`;
const precisionText = (p: z.infer<typeof precision> | null) => (p ? `precision ${pct(p.lo)}–${pct(p.hi)} (n=${p.n})` : "precision not measured");
const recallText = (r: z.infer<typeof recall>) => `recall ${r.hits}/${r.n} announced rounds`;

/** The one mono eval line on the first screen (design IA3 item 4). */
export function evalLine(e: ReleaseEval): string {
  const s = e.systems;
  return [
    `Release evaluation · ${formatDate(e.evaluatedOn)} · does not rewind`,
    `rules + Claude: ${precisionText(s.rulesPlusClaude.precision)}, ${recallText(s.rulesPlusClaude.recall)}`,
    `rules-only: ${precisionText(s.rulesOnly.precision)}, ${recallText(s.rulesOnly.recall)}`,
  ].join(" · ");
}

export const missesSummary = (e: ReleaseEval) => `${e.misses.length} ${e.misses.length === 1 ? "miss" : "misses"} among ${e.cohortSize} evaluated rounds.`;
