// The release-independent classification cache in Neon (idempotency key: input hash + model +
// prompt version). Refusals are stored with error "refusal" so they map to abstain.
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { classifications } from "../../db/schema";
import type { ClassificationStore, StoredClassification } from "./classify";

export const dbClassificationStore: ClassificationStore = {
  async get(inputHash, modelId, promptVersion) {
    const [r] = await db()
      .select()
      .from(classifications)
      .where(and(eq(classifications.inputHash, inputHash), eq(classifications.modelId, modelId), eq(classifications.promptVersion, promptVersion)));
    if (!r) return null;
    const refusal = r.error === "refusal";
    return {
      inputHash,
      modelId,
      promptVersion,
      output: r.score === null || r.error ? null : { score: r.score, rationale: r.rationale ?? "", citedRuleIds: r.citedRuleIds },
      refusal,
      error: refusal ? null : (r.error as StoredClassification["error"]),
      usage: { inputTokens: r.inputTokens ?? 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: r.outputTokens ?? 0, costUsd: 0 },
    };
  },
  async put(c) {
    await db()
      .insert(classifications)
      .values({
        inputHash: c.inputHash,
        modelId: c.modelId,
        promptVersion: c.promptVersion,
        score: c.output?.score ?? null,
        rationale: c.output?.rationale ?? null,
        citedRuleIds: c.output?.citedRuleIds ?? [],
        error: c.refusal ? "refusal" : c.error,
        inputTokens: c.usage.inputTokens + c.usage.cacheCreationTokens + c.usage.cacheReadTokens,
        outputTokens: c.usage.outputTokens,
      })
      .onConflictDoNothing();
  },
};
