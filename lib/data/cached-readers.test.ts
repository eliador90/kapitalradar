import { beforeEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({
  readCurrentRelease: vi.fn(),
  readDailySeries: vi.fn(async () => []),
  readCantonCounts: vi.fn(async () => ({})),
  readFeedWeek: vi.fn(async () => []),
  readCompany: vi.fn(async () => null),
}));
const options = vi.hoisted(() => new Map<string, { revalidate?: number | false; tags?: string[] }>());

vi.mock("./readers", () => readers);
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown, keyParts: string[], opts: { revalidate?: number | false; tags?: string[] }) => {
    options.set(keyParts.at(-1)!, opts);
    return fn;
  },
}));

const { cachedCompany, cachedCurrentRelease, cachedFeedWeek } = await import("./cached-readers");

const release = { id: "r9", snapshotDate: "2026-11-01", backfillStart: "2025-08-01", config: { tau: 0.5 }, evalResult: { big: true } };

describe("cached readers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keys rows on the release id, not on its config or eval", async () => {
    await cachedFeedWeek(release, "2026-10-01", "2026-09-28", "2026-10-01");
    expect(readers.readFeedWeek).toHaveBeenCalledWith({ id: "r9", backfillStart: "2025-08-01" }, "2026-10-01", "2026-09-28", "2026-10-01");
    await cachedCompany(release, "CHE123456789", "2026-10-01");
    expect(readers.readCompany).toHaveBeenCalledWith({ id: "r9", backfillStart: "2025-08-01" }, "CHE123456789", "2026-10-01");
  });

  it("lets only the pointer to the current release expire", () => {
    expect(options.get("current-release")?.revalidate).toBe(86400);
    for (const key of ["daily-series", "canton-counts", "feed-week", "company"]) expect(options.get(key)?.revalidate).toBe(false);
  });

  it("throws on a missing current release, which is never cached", async () => {
    readers.readCurrentRelease.mockResolvedValueOnce(null);
    await expect(cachedCurrentRelease()).rejects.toThrow("no current release");
  });
});
