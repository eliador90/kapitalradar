// DT7: the curated rewind company comes from inspected companies only, never the sealed recall
// cohort (and, being in the ledger, never a precision holdout).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { featuredRewind, featuredRewindText } from "../lib/domain/featured";
import { readLedger } from "./lib/ledger";
import { cohortFile } from "./lib/schemas";

describe("featured rewind", () => {
  it("is an inspected company outside the sealed cohort", () => {
    expect(readLedger().map((e) => e.uid)).toContain(featuredRewind.uid);
    const { cohort } = cohortFile.parse(JSON.parse(readFileSync("eval/cohort.json", "utf8")));
    expect(cohort.map((r) => r.uid)).not.toContain(featuredRewind.uid);
  });

  it("rewinds to a date before the announcement", () => {
    expect(featuredRewind.asOf < featuredRewind.announced).toBe(true);
    expect(featuredRewindText()).toBe("Try a rewind: Soverli AG on 24 Sep 2025, 83 days before the round was announced");
  });
});
