// ReleaseRepo on Neon. Activation is one transaction (drizzle neon-http batch): release status
// and the current_release pointer change together or not at all.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { assessments, classifications, companyNames, confirmations, currentRelease, events, releases } from "../../db/schema";
import type { ReleaseRepo } from "./release";

const BATCH = 500;
async function inBatches<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH));
}

export function dbReleaseRepo(modelId: string, promptVersion: string): ReleaseRepo {
  return {
    async currentReleaseId() {
      const [r] = await db().select({ id: currentRelease.releaseId }).from(currentRelease).where(eq(currentRelease.id, 1));
      return r?.id ?? null;
    },
    async createRelease(r) {
      await db().insert(releases).values({ id: r.id, status: "building", snapshotDate: r.snapshotDate, backfillStart: r.backfillStart, config: r.config });
    },
    async writeEvents(releaseId, rows) {
      await inBatches(rows, (chunk) => db().insert(events).values(chunk.map((e) => ({ ...e, releaseId, type: e.type as never, contributionType: e.contributionType as never }))));
    },
    async writeCompanyNames(releaseId, rows) {
      await inBatches(rows, (chunk) => db().insert(companyNames).values(chunk.map((n) => ({ ...n, releaseId }))).onConflictDoNothing());
    },
    async writeAssessments(releaseId, rows) {
      // Resolve classification ids by input hash (model + prompt version are the release's).
      const hashes = [...new Set(rows.map((r) => r.classificationInputHash).filter((h): h is string => h !== null))];
      const idByHash = new Map<string, string>();
      for (let i = 0; i < hashes.length; i += BATCH) {
        const found = await db()
          .select({ id: classifications.id, hash: classifications.inputHash })
          .from(classifications)
          .where(and(inArray(classifications.inputHash, hashes.slice(i, i + BATCH)), eq(classifications.modelId, modelId), eq(classifications.promptVersion, promptVersion)));
        for (const f of found) idByHash.set(f.hash, f.id);
      }
      await inBatches(rows, (chunk) =>
        db()
          .insert(assessments)
          .values(
            chunk.map((a) => ({
              releaseId,
              eventId: a.eventId,
              tier: a.tier,
              ruleHits: a.ruleHits,
              rulesScore: a.rulesScore,
              rulesPositive: a.rulesPositive,
              rejectReason: a.rejectReason,
              classificationId: a.classificationInputHash ? (idByHash.get(a.classificationInputHash) ?? null) : null,
            })),
          ),
      );
    },
    async writeConfirmations(releaseId, rows) {
      await inBatches(rows, (chunk) =>
        db()
          .insert(confirmations)
          .values(chunk.map((c) => ({ ...c, releaseId, reviewedAt: c.reviewedAt ? new Date(c.reviewedAt) : null }))),
      );
    },
    async setEvalResult(releaseId, evalResult) {
      await db().update(releases).set({ evalResult }).where(eq(releases.id, releaseId));
    },
    async markFailed(releaseId, reason) {
      await db().update(releases).set({ status: "failed", failureReason: reason }).where(eq(releases.id, releaseId));
    },
    async activate(releaseId) {
      await db().batch([
        db().update(releases).set({ status: "ready", activatedAt: sql`now()` }).where(eq(releases.id, releaseId)),
        db().insert(currentRelease).values({ id: 1, releaseId }).onConflictDoUpdate({ target: currentRelease.id, set: { releaseId, updatedAt: sql`now()` } }),
      ]);
    },
  };
}
