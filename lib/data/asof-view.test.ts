import { describe, expect, it } from "vitest";
import { correctedAt, nameAt, visibleEvents, type DatedEvent } from "./asof-view";

const ev = (id: string, publishedAt: string, over: Partial<DatedEvent> = {}): DatedEvent => ({
  id,
  publicationId: id,
  publicationNumber: `HR02-${id}`,
  publishedAt,
  type: "capital_change",
  cancelsPublicationNumber: null,
  correctsPublicationNumber: null,
  ...over,
});

describe("as-of view", () => {
  const events = [
    ev("1", "2026-01-10"),
    ev("2", "2026-02-10"),
    ev("3", "2026-03-10", { type: "cancellation", cancelsPublicationNumber: "HR02-2" }),
    ev("4", "2026-04-10", { correctsPublicationNumber: "HR02-1" }),
  ];

  it("shows a publication dated on the asOf day (inclusive) and nothing later", () => {
    expect(visibleEvents(events, "2026-02-10").map((e) => e.id)).toEqual(["1", "2"]);
    expect(visibleEvents(events, "2026-02-09").map((e) => e.id)).toEqual(["1"]);
  });

  it("hides a cancelled publication from the cancellation's date onward only", () => {
    expect(visibleEvents(events, "2026-03-09").map((e) => e.id)).toEqual(["1", "2"]);
    expect(visibleEvents(events, "2026-03-10").map((e) => e.id)).toEqual(["1"]);
  });

  it("marks corrections only once they are published", () => {
    expect(correctedAt(events, "2026-04-09").size).toBe(0);
    expect(correctedAt(events, "2026-04-10").get("HR02-1")).toBe("2026-04-10");
  });

  it("folds the name as of the date", () => {
    const names = [
      { name: "Old AG", publishedAt: "2025-01-01" },
      { name: "New AG", publishedAt: "2026-05-01" },
    ];
    expect(nameAt(names, "2026-04-30")).toBe("Old AG");
    expect(nameAt(names, "2026-05-01")).toBe("New AG");
    expect(nameAt(names, "2024-12-31")).toBeNull();
  });
});
