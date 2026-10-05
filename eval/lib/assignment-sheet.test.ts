import { describe, expect, it } from "vitest";
import { parseSheet } from "./assignment-sheet";

const block = (n: string, rel: string, type: string, reason: string) =>
  `## A${n} · HR02-1 · 2026-01-01 · de\n\ntext\n\n- startup_relevance: ${rel}\n- transaction_type: ${type}\n- reason: ${reason}\n\n`;

describe("parseSheet", () => {
  it("reads filled blocks", () => {
    expect(parseSheet(`# head\n\n${block("01", "yes", "new_equity", "seed preferred")}`)).toEqual([
      { n: 1, startup_relevance: "yes", transaction_type: "new_equity", reason: "seed preferred" },
    ]);
  });

  it("names the entry with a missing field", () => {
    expect(() => parseSheet(block("07", "yes", "", "x"))).toThrow(/A7: transaction_type/);
  });
});
