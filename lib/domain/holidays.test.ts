import { describe, expect, it } from "vitest";
import { easterSunday, isGazetteDay } from "./holidays";

describe("SHAB holidays", () => {
  it("computes Easter", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
  });

  it("explains every empty weekday of the 2025-08..2026-10 backfill", () => {
    // The nine weekdays the ingest found without HR02 entries (T4 backfill).
    for (const d of ["2025-08-01", "2025-12-25", "2025-12-26", "2026-01-01", "2026-01-02", "2026-04-03", "2026-04-06", "2026-05-14", "2026-05-25"]) {
      expect(isGazetteDay(d), d).toBe(false);
    }
    expect(isGazetteDay("2026-09-29")).toBe(true);
    expect(isGazetteDay("2026-10-04")).toBe(false); // Sunday
  });
});
