import { afterEach, describe, expect, it, vi } from "vitest";
import { politeFetch } from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("politeFetch", () => {
  it("spaces concurrent requests to one host by the minimum interval", async () => {
    const at: number[] = [];
    vi.stubGlobal("fetch", async () => {
      at.push(Date.now());
      return new Response("ok");
    });
    const host = `https://rate-${Date.now()}.test/x`;
    await Promise.all(Array.from({ length: 5 }, () => politeFetch(host, { minIntervalMs: 40 })));
    // Without slot reservation all five fire within a few ms of each other.
    at.forEach((t, i) => expect(t - at[0]!).toBeGreaterThanOrEqual(i * 40 - 10));
  });
});
