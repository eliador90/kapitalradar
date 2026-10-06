// Plan CI: the release-isolation test (a failed build leaves the current release's reads
// unchanged, eng V3) plus successful activation and rollback (eng delta V13).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ReleaseConfig } from "../domain/schemas";
import { assembleCompany } from "./candidates";
import { parsePublication } from "./parse";
import { buildRelease, missingGazetteDays, rollback, type BuildInput, type ReleaseRepo } from "./release";

vi.mock("../../db/client", () => ({ db: () => { throw new Error("no DB in unit tests"); } }));

class MemoryRepo implements ReleaseRepo {
  current: string | null = null;
  releases = new Map<string, { status: string; reason?: string }>();
  rows = new Map<string, { events: unknown[]; assessments: { tier: string }[] }>();
  failOn: string | null = null;
  async currentReleaseId() { return this.current; }
  async createRelease(r: { id: string }) { this.releases.set(r.id, { status: "building" }); this.rows.set(r.id, { events: [], assessments: [] }); }
  async writeEvents(id: string, rows: unknown[]) { if (this.failOn === "events") throw new Error("disk full"); this.rows.get(id)!.events.push(...rows); }
  async writeCompanyNames() {}
  async writeAssessments(id: string, rows: { tier: string }[]) { if (this.failOn === "assessments") throw new Error("timeout"); this.rows.get(id)!.assessments.push(...rows); }
  async writeConfirmations() {}
  async setEvalResult() {}
  async markFailed(id: string, reason: string) { this.releases.set(id, { status: "failed", reason }); }
  async activate(id: string) { this.releases.set(id, { status: "ready" }); this.current = id; }
  /** What a visitor reads: rows of the current release only. */
  read() { return this.current ? this.rows.get(this.current) : undefined; }
}

const config: ReleaseConfig = { rules: [], rulesThreshold: 1, tau: 0.6, tauLow: 0.4, modelId: "m", promptVersion: "1", parserVersion: "2" };
const pub = parsePublication(readFileSync("eval/fixtures/shab/de-new-preferred-preseed.xml", "utf8"));
const company = { ...assembleCompany(pub.companyUid!, [pub], null, { weights: {}, threshold: 1 }), parseFailures: [] };
const allDays = (from: string, to: string) => {
  const s = new Set<string>();
  for (let d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + 1)) s.add(d.toISOString().slice(0, 10));
  return s;
};
const input = (id: string, over: Partial<BuildInput> = {}): BuildInput => ({
  releaseId: id,
  snapshotDate: "2025-09-30",
  backfillStart: "2025-09-01",
  config,
  companies: [company],
  classification: () => ({ inputHash: "h", modelId: "m", promptVersion: "1", output: { score: 0.9, rationale: "r", citedRuleIds: [] }, refusal: false, error: null, usage: { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0 } }),
  confirmations: [],
  daysWithEntries: allDays("2025-09-01", "2025-09-30"),
  evalResult: { recall: 1 },
  ...over,
});
const quiet = () => {};

describe("release build", () => {
  it("activates a release whose gates pass", async () => {
    const repo = new MemoryRepo();
    const r = await buildRelease(input("r1"), repo, quiet);
    expect(r.activated).toBe(true);
    expect(repo.current).toBe("r1");
    expect(repo.read()!.assessments[0]!.tier).toBe("likely_financing");
  });

  it("keeps the live release when a build fails its gates or its writes (isolation, eng V3)", async () => {
    const repo = new MemoryRepo();
    await buildRelease(input("r1"), repo, quiet);
    const before = JSON.stringify(repo.read());

    const gated = await buildRelease(input("r2", { evalResult: null }), repo, quiet);
    expect(gated.activated).toBe(false);
    expect(repo.releases.get("r2")!.status).toBe("failed");

    repo.failOn = "assessments";
    await expect(buildRelease(input("r3"), repo, quiet)).rejects.toThrow("timeout");
    expect(repo.releases.get("r3")!.status).toBe("failed");

    expect(repo.current).toBe("r1");
    expect(JSON.stringify(repo.read())).toBe(before);
  });

  it("fails the gates on missing gazette days and classifier errors", async () => {
    const repo = new MemoryRepo();
    const days = allDays("2025-09-01", "2025-09-30");
    days.delete("2025-09-15"); // a Monday with a gazette
    const r = await buildRelease(input("r1", { daysWithEntries: days, classification: () => null }), repo, quiet);
    expect(r.gates.missingGazetteDays).toEqual(["2025-09-15"]);
    expect(r.gates.classifierErrorRate).toBe(1);
    expect(r.activated).toBe(false);
  });

  it("rolls back by re-pointing to the previous release", async () => {
    const repo = new MemoryRepo();
    await buildRelease(input("r1"), repo, quiet);
    await buildRelease(input("r2", { classification: () => ({ inputHash: "h", modelId: "m", promptVersion: "1", output: { score: 0.1, rationale: "r", citedRuleIds: [] }, refusal: false, error: null, usage: { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0 } }) }), repo, quiet);
    expect(repo.read()!.assessments[0]!.tier).toBe("capital_increased");
    await rollback(repo, "r1");
    expect(repo.current).toBe("r1");
    expect(repo.read()!.assessments[0]!.tier).toBe("likely_financing");
  });

  it("assesses only events inside the backfill window; earlier history stays not assessed", async () => {
    const repo = new MemoryRepo();
    const later = "2099-01-01";
    const r = await buildRelease(input("r1", { backfillStart: later, snapshotDate: later, daysWithEntries: allDays(later, later) }), repo, quiet);
    expect(r.counts.events).toBeGreaterThan(0);
    expect(r.counts.assessments).toBe(0);
    expect(r.counts.candidates).toBe(0);
  });

  it("gives a capital reduction no assessment (it carries no tier)", async () => {
    const red = parsePublication(readFileSync("eval/fixtures/shab/fr-reduction.xml", "utf8"));
    const reducing = { ...assembleCompany(red.companyUid!, [red], null, { weights: {}, threshold: 1 }), parseFailures: [] };
    const repo = new MemoryRepo();
    const r = await buildRelease(input("r1", { companies: [reducing], snapshotDate: "2099-01-01", backfillStart: "2000-01-01", daysWithEntries: new Set() }), repo, quiet);
    expect(r.counts.events).toBeGreaterThan(0);
    expect(r.counts.assessments).toBe(0);
  });

  it("ignores holidays and weekends when checking for empty gazette days", () => {
    expect(missingGazetteDays(new Set(), "2025-12-24", "2025-12-28")).toEqual(["2025-12-24"]);
  });
});
