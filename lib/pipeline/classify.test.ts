import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ParsedEvent } from "../domain/events";
import {
  classifyOne,
  freezeThresholds,
  runClassifications,
  tierFor,
  UsageLimitError,
  type BackendReply,
  type ClassificationStore,
  type ClassifierBackend,
  type StoredClassification,
} from "./classify";
import { parsePublication } from "./parse";
import { buildClassifierInput, inputHash, nameTerms, redactText, type ClassifierInput } from "./redact";

const usage = { inputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 5, costUsd: 0.001 };
const reply = (structured: unknown, over: Partial<BackendReply> = {}): BackendReply => ({ structured, text: JSON.stringify(structured), refusal: false, usage, ...over });

class FakeBackend implements ClassifierBackend {
  readonly modelId = "fake";
  calls = 0;
  constructor(private readonly script: (n: number, msg: string) => BackendReply | Error) {}
  async call(_s: string, msg: string): Promise<BackendReply> {
    const r = this.script(++this.calls, msg);
    if (r instanceof Error) throw r;
    return r;
  }
}

const input = (fired: string[] = ["new_preferred_class"]): ClassifierInput => ({
  legalForm: "AG/SA",
  canton: "ZH",
  companyAge: "under_2",
  currency: "CHF",
  nominalCapitalBefore: "100000.00",
  nominalCapitalAfter: "138717.94",
  sharesBefore: 10_000_000,
  sharesAfter: 13_871_794,
  shareClassesAfter: "unknown",
  newPreferredClass: true,
  contribution: "cash",
  withinCapitalBand: false,
  duringConversionFromGmbH: false,
  purpose: "Entwicklung von KI-Lösungen",
  firedRules: fired.map((id) => ({ id: id as never, description: "x" })),
});

describe("classifyOne failure modes", () => {
  it("accepts valid output citing fired rules", async () => {
    const b = new FakeBackend(() => reply({ score: 0.9, rationale: "new preferred class", citedRuleIds: ["new_preferred_class"] }));
    expect((await classifyOne(b, "sys", input())).output?.score).toBe(0.9);
  });

  it("retries malformed output once, then records the error", async () => {
    const b = new FakeBackend(() => reply({ score: "high" }));
    const c = await classifyOne(b, "sys", input());
    expect([c.error, c.attempts, b.calls]).toEqual(["malformed_json", 2, 2]);
  });

  it("retries empty output once and recovers", async () => {
    const b = new FakeBackend((n) => (n === 1 ? reply(null, { text: "" }) : reply({ score: 0.2, rationale: "r", citedRuleIds: [] })));
    const c = await classifyOne(b, "sys", input());
    expect([c.error, c.output?.score, c.attempts]).toEqual([null, 0.2, 2]);
  });

  it("rejects citations outside the fired rules without retrying (eng Q3)", async () => {
    const b = new FakeBackend(() => reply({ score: 0.9, rationale: "r", citedRuleIds: ["young_company"] }));
    const c = await classifyOne(b, "sys", input());
    expect([c.error, b.calls]).toEqual(["invalid_rule_ids", 1]);
  });

  it("maps a refusal to abstain", async () => {
    const c = await classifyOne(new FakeBackend(() => reply(null, { refusal: true, text: "" })), "sys", input());
    expect(c.refusal).toBe(true);
    expect(tierFor(null, 0.6, 0.4, c.refusal)).toBe("abstain");
  });

  it("propagates usage-limit errors", async () => {
    await expect(classifyOne(new FakeBackend(() => new UsageLimitError("limit")), "sys", input())).rejects.toThrow(UsageLimitError);
  });
});

describe("freezeThresholds (decision log #17)", () => {
  it("applies the pre-stated rule to the dev scores", () => {
    const pos = [0.5, 0.55, 0.6, 0.6, 0.6, 0.65, 0.7, 0.75, 0.75, 0.82, 0.82, 0.82, 0.85, 0.85, 0.85, 0.85, 0.88, 0.9, 0.93, 0.93, 0.96];
    const neg = [0.02, 0.02, 0.03, 0.05, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3];
    expect(freezeThresholds(pos, neg)).toEqual({ tau: 0.6, tauLow: 0.35 });
  });

  it("raises τ above any dev negative", () => {
    expect(freezeThresholds([0.5, 0.6, 0.7, 0.8, 0.9], [0.1, 0.65])).toEqual({ tau: 0.7, tauLow: 0.7 });
  });
});

describe("tierFor", () => {
  it.each([
    [0.8, "likely_financing"],
    [0.6, "likely_financing"],
    [0.5, "abstain"],
    [0.4, "abstain"],
    [0.39, "capital_increased"],
  ] as const)("%s → %s", (score, tier) => expect(tierFor(score, 0.6, 0.4)).toBe(tier));
});

describe("runClassifications (T18)", () => {
  class MemoryStore implements ClassificationStore {
    rows = new Map<string, StoredClassification>();
    async get(h: string, m: string, p: string) {
      return this.rows.get(`${h}|${m}|${p}`) ?? null;
    }
    async put(c: StoredClassification) {
      this.rows.set(`${c.inputHash}|${c.modelId}|${c.promptVersion}`, c);
    }
  }
  const items = Array.from({ length: 6 }, (_, i) => ({ inputHash: `h${i}`, input: input() }));
  const ok = () => reply({ score: 0.7, rationale: "r", citedRuleIds: [] });
  const quiet = { systemPrompt: "sys", log: () => {}, concurrency: 1 };

  it("stops cleanly at a usage limit, keeps finished items, and a rerun classifies only the rest", async () => {
    const store = new MemoryStore();
    const failing = new FakeBackend((n) => (n === 4 ? new UsageLimitError("usage limit reached") : ok()));
    const first = await runClassifications(items, failing, store, quiet);
    expect([first.classified, first.stoppedForUsageLimit, store.rows.size]).toEqual([3, true, 3]);
    const again = new FakeBackend(ok);
    const second = await runClassifications(items, again, store, { ...quiet });
    // Same model id as the store keys: use the same fake id for both backends.
    expect(second.cached).toBe(3);
    expect(again.calls).toBe(3);
    expect(store.rows.size).toBe(6);
  });

  it("never pays twice for the same input, and honours the cap", async () => {
    const store = new MemoryStore();
    const b = new FakeBackend(ok);
    const dupes = [...items, ...items];
    const s = await runClassifications(dupes, b, store, { ...quiet, cap: 4 });
    expect(b.calls).toBe(4);
    expect(s.stoppedAtCap).toBe(true);
  });

  it("does not store backend failures, so they are retried", async () => {
    const store = new MemoryStore();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const b = new FakeBackend(() => new Error("network"));
    const s = await runClassifications(items.slice(0, 2), b, store, quiet);
    expect([s.errors.backend, store.rows.size]).toEqual([2, 0]);
    vi.restoreAllMocks();
  });
});

describe("redaction (plan: a fixture test proves it)", () => {
  const p = parsePublication(readFileSync("eval/fixtures/shab/de-conversion-name-change.xml", "utf8"));
  const e = p.events.find((x) => x.type === "capital_change") as Extract<ParsedEvent, { type: "capital_change" }>;
  const names = [p.companyName, p.previousName!, "OPTIML AG (OPTIML SA) (OPTIML Ltd)"];

  it("removes names, translations, distinctive words, UID, seat, streets and links", () => {
    expect(nameTerms(["PreComb Therapeutics AG"])).toEqual(expect.arrayContaining(["PreComb Therapeutics AG", "PreComb Therapeutics", "PreComb"]));
    const t = redactText("OPTIML SA, Optiml platform by OPTIML GmbH, CHE-178.002.184, in Zürich, Bahnhofstrasse 12, 8001 Zürich, www.optiml.com, souscrites par l'associé Jean Exemple", names, "Zürich");
    for (const leak of ["OPTIML", "Optiml", "178.002.184", "Zürich", "Bahnhofstrasse", "optiml.com", "Jean Exemple"]) expect(t).not.toContain(leak);
    expect(t).toContain("[company]");
  });

  it("builds an input with no identity fields and a stable hash", () => {
    const i = buildClassifierInput({ event: e, sharesBefore: null, newPreferredClass: null, ageBucket: "under_2", canton: "ZH", purpose: p.purpose + " OPTIML", names, seat: p.seat, firedRuleIds: ["tech_purpose"] });
    const json = JSON.stringify(i);
    expect(json).not.toMatch(/OPTIML|CHE-178|Zürich/i);
    expect(i.firedRules[0]!.id).toBe("tech_purpose");
    expect(inputHash(i)).toBe(inputHash(JSON.parse(json)));
  });
});
