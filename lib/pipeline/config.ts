// The one place classification settings are read from (config/classification.json). A release
// copies them, with the rule catalog, into releases.config (eng delta V14).
import { readFileSync } from "node:fs";
import { z } from "zod";
import { RULES } from "../domain/rule-catalog";
import type { ReleaseConfig } from "../domain/schemas";
import type { RuleConfig } from "./rules";

export const CONFIG_FILE = "config/classification.json";

const fileSchema = z.object({
  rulesThreshold: z.number(),
  tau: z.number().min(0).max(1).nullable(),
  tauLow: z.number().min(0).max(1).nullable(),
  modelId: z.string(),
  promptVersion: z.string(),
  frozenAt: z.string().nullable(),
});
export type ClassificationConfig = z.infer<typeof fileSchema>;

export const loadClassificationConfig = (file = CONFIG_FILE): ClassificationConfig => fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));

export const ruleConfigFrom = (c: ClassificationConfig): RuleConfig => ({ weights: Object.fromEntries(RULES.map((r) => [r.id, r.weight])), threshold: c.rulesThreshold });

/** The release snapshot; throws until τ is frozen, so no release ships without it. */
export function releaseConfigFrom(c: ClassificationConfig, parserVersion: string): ReleaseConfig {
  if (c.tau === null || c.tauLow === null || !c.frozenAt) throw new Error(`${CONFIG_FILE}: tau/tauLow not frozen yet`);
  return {
    rules: RULES.map((r) => ({ id: r.id, kind: r.kind, weight: r.weight, display: r.display })),
    rulesThreshold: c.rulesThreshold,
    tau: c.tau,
    tauLow: c.tauLow,
    modelId: c.modelId,
    promptVersion: c.promptVersion,
    parserVersion,
  };
}
