// Frozen domain vocabulary shared by pipeline, eval and app (eng: Foundation). Change only
// in the main tree; the DB enums in db/schema.ts are built from these lists.
import { z } from "zod";
import { isIsoDate } from "./dates";
import { isCanonicalUid } from "./uid";

export const isoDate = z.string().refine(isIsoDate, "expected an ISO calendar date");
export const uid = z.string().refine(isCanonicalUid, "expected a canonical UID (CHE + 9 digits)");

export const TIERS = ["capital_increased", "abstain", "likely_financing"] as const;
export const tier = z.enum(TIERS);
export type Tier = z.infer<typeof tier>;

export const EVENT_TYPES = [
  "capital_change",
  "conversion_to_ag",
  "capital_band",
  "formation",
  "cancellation",
  "name_change",
] as const;
export const eventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventType>;

export const CONTRIBUTION_TYPES = ["cash", "set_off", "in_kind", "mixed", "conditional_capital", "unknown"] as const;
export const contributionType = z.enum(CONTRIBUTION_TYPES);
export type ContributionType = z.infer<typeof contributionType>;

export const MATCH_CONFIDENCES = ["high", "low"] as const;
export const matchConfidence = z.enum(MATCH_CONFIDENCES);
export type MatchConfidence = z.infer<typeof matchConfidence>;

export const EVENT_MATCHES = ["accepted", "rejected", "uncertain"] as const;
export const eventMatch = z.enum(EVENT_MATCHES);
export type EventMatch = z.infer<typeof eventMatch>;

export const RULE_KINDS = ["positive", "negative", "hard_negative"] as const;

/** A character span inside a publication's text (evidence-reference integrity, CI). */
export const textSpan = z.object({
  publicationId: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

/** Structured classifier output (validated with Zod; cited ids must be a subset of fired ids). */
export const classifierOutput = z.object({
  score: z.number().min(0).max(1),
  rationale: z.string().min(1).max(600),
  citedRuleIds: z.array(z.string()),
});
export type ClassifierOutput = z.infer<typeof classifierOutput>;

/** Snapshot of the classification config stored per release (eng delta V14). */
export const releaseConfig = z.object({
  rules: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(RULE_KINDS),
      weight: z.number(),
      display: z.string(),
    }),
  ),
  rulesThreshold: z.number(),
  tau: z.number().min(0).max(1),
  tauLow: z.number().min(0).max(1),
  modelId: z.string(),
  promptVersion: z.string(),
  parserVersion: z.string(),
});
export type ReleaseConfig = z.infer<typeof releaseConfig>;
