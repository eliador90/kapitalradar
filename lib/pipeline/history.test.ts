import { describe, expect, it, vi } from "vitest";
import { coverageLine, ageBucket } from "../domain/coverage";
import type { ParsedEvent } from "../domain/events";
import { foldCapitalContext } from "./fold";
import { runHistory, type HistoryDeps, type HistoryResult } from "./history";

vi.mock("../../db/client", () => ({ db: () => { throw new Error("no DB in unit tests"); } }));

const result = (_uid: string): HistoryResult => ({ listed: 1, newlyStored: 1, foreignMentions: 0, ownPublications: 1, formationFound: true, foundedOn: "2020-01-01", zefixRefs: 0, zefixError: null });

function fakeDeps(failOn = new Set<string>()) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const deps: HistoryDeps = {
    refresh: async (uid) => {
      calls.push(uid);
      if (failOn.has(uid)) throw new Error("boom");
      return result(uid);
    },
    doneKeys: async (job) => new Set([...store].filter(([k, s]) => k.startsWith(`${job}|`) && s === "done").map(([k]) => k.split("|")[1]!)),
    mark: async (job, uid, status) => store.set(`${job}|${uid}`, status),
  };
  return { deps, calls, store };
}

describe("runHistory", () => {
  const uids = ["CHE000000001", "CHE000000002", "CHE000000003", "CHE000000004"];
  const quiet = { log: () => {}, concurrency: 1 };

  it("resumes an interrupted run from the checkpoints", async () => {
    const { deps, calls } = fakeDeps();
    let n = 0;
    const first = await runHistory(uids, "r1", { ...quiet, stop: () => n++ >= 2 }, deps);
    expect(first.done).toBe(2);
    const second = await runHistory(uids, "r1", quiet, deps);
    expect(second.skippedDone).toBe(2);
    expect(second.done).toBe(2);
    expect(calls).toEqual(uids); // each company fetched exactly once across both runs
  });

  it("counts and records failures, retries them on the next run, and refetches in a new run key", async () => {
    const { deps, calls, store } = fakeDeps(new Set(["CHE000000002"]));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await runHistory(uids, "r1", quiet, deps);
    expect([s.done, s.failed]).toEqual([3, 1]);
    expect(store.get("history:r1|CHE000000002")).toBe("failed");
    await runHistory(uids, "r1", quiet, deps);
    expect(calls.filter((u) => u === "CHE000000002")).toHaveLength(2); // retried, not skipped
    const fresh = await runHistory(uids, "r2", quiet, deps); // a new build refetches every company (eng V5)
    expect(fresh.skippedDone).toBe(0);
  });
});

describe("foldCapitalContext", () => {
  type Capital = Extract<ParsedEvent, { type: "capital_change" }>;
  const cc = (over: Partial<Omit<Capital, "payload">> & { payload?: Partial<Capital["payload"]> }): ParsedEvent => ({
    type: "capital_change",
    contributionType: "cash",
    currency: "CHF",
    capitalBefore: "100000.00",
    capitalAfter: "120000.00",
    sharesBefore: null,
    sharesAfter: 120,
    ...over,
    payload: {
      direction: "increase", restructuringPair: false, withConversion: false, withinCapitalBand: false, paidBefore: null, paidAfter: null,
      classesBefore: null, classesAfter: null, sharesIssued: null, setOffAmount: null, setOffCurrency: null, newPreferredClass: null,
      nominalChanged: false, participationCapital: false, ...(over.payload ?? {}),
    },
  });
  const pref = (label: string) => ({ count: 10, nominal: "1", currency: "CHF" as const, label, preferred: true });

  it("chains share counts and preferred classes from the previous event, never from later ones", () => {
    const pubs = [
      { publicationNumber: "HR02-3", publishedAt: "2026-03-01", legalDate: "2026-02-20", events: [cc({ capitalBefore: "120000.00", capitalAfter: "150000.00", sharesAfter: 150, payload: { classesAfter: [pref("série A"), pref("seed")] } })] },
      { publicationNumber: "HR01-1", publishedAt: "2024-01-10", legalDate: "2024-01-05", events: [{ type: "formation", payload: { purpose: "x", foundedOn: "2024-01-05" } } as ParsedEvent] },
      { publicationNumber: "HR02-2", publishedAt: "2025-06-01", legalDate: "2025-05-20", events: [cc({ sharesBefore: 100, payload: { classesAfter: [pref("seed")] } }), { type: "capital_band", payload: { action: "adopted" } } as ParsedEvent] },
    ];
    const ctx = foldCapitalContext(pubs, null);
    expect(ctx.get("HR02-2")).toMatchObject({ sharesBefore: 100, sharesBeforeSource: "entry", newPreferredClass: null, priorCapitalBand: false, foundedOn: "2024-01-05", ageBucket: "under_2" });
    expect(ctx.get("HR02-3")).toMatchObject({ sharesBefore: 120, sharesBeforeSource: "previous_event", newPreferredClass: true, priorCapitalBand: true, ageBucket: "2_to_6" });
  });

  it("doesn't chain across a gap in capital and uses the source founding date only once it is past", () => {
    const pubs = [
      { publicationNumber: "HR02-1", publishedAt: "2025-01-01", legalDate: "2025-01-01", events: [cc({ sharesBefore: 100 })] },
      { publicationNumber: "HR02-2", publishedAt: "2026-01-01", legalDate: "2026-01-01", events: [cc({ capitalBefore: "130000.00", capitalAfter: "140000.00" })] },
    ];
    const ctx = foldCapitalContext(pubs, "2025-06-01");
    expect(ctx.get("HR02-1")).toMatchObject({ foundedOn: null, ageBucket: "unknown" });
    expect(ctx.get("HR02-2")).toMatchObject({ sharesBefore: null, sharesBeforeSource: "unknown", foundedOn: "2025-06-01" });
  });
});

describe("coverage", () => {
  const base = { formationFound: false, foundedOn: null, earliestShabPublished: null, earliestZefixRef: null, historyLookupFailed: false };
  it("states what the record covers", () => {
    expect(coverageLine({ ...base, formationFound: true, foundedOn: "2019-02-14", earliestShabPublished: "2019-02-20" }, "2025-08-01")).toBe("History from 14 Feb 2019");
    expect(coverageLine({ ...base, earliestShabPublished: "2019-05-31", earliestZefixRef: "2017-02-28" }, "2025-08-01")).toBe("History from 28 Feb 2017");
    expect(coverageLine({ ...base, historyLookupFailed: true }, "2025-08-01")).toBe("Partial history: Aug 2025 onward only");
  });
  it("buckets age and leaves unknown founding dates unknown (eng Q4)", () => {
    expect(ageBucket(null, "2026-01-01")).toBe("unknown");
    expect(ageBucket("2020-01-01", "2026-06-01")).toBe("6_plus");
  });
});
