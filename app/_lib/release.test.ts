import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/data/readers", () => ({ readCurrentRelease: async () => null }));
const { canonicalRedirect, hrefWith } = await import("./release");

describe("canonical URLs", () => {
  it("leaves a canonical query alone", () => {
    expect(canonicalRedirect("/", { asof: "2026-09-27", s: "all" }, { asof: "2026-09-27", s: "all" })).toBeNull();
    expect(canonicalRedirect("/", {}, { asof: null, s: null })).toBeNull();
  });
  it("drops defaults spelled out, repeated filters and unknown keys", () => {
    expect(canonicalRedirect("/", { asof: "2026-10-06" }, { asof: null })).toBe("/");
    expect(canonicalRedirect("/", { s: ["likely", "confirmed"] }, { s: null })).toBe("/");
    expect(canonicalRedirect("/", { s: ["likely", "increased"] }, { s: "likely,increased" })).toBe("/?s=likely%2Cincreased");
    expect(canonicalRedirect("/c/CHE123456789", { utm: "x" }, { asof: null })).toBe("/c/CHE123456789");
  });
  it("is a fixpoint: following the redirect does not redirect again", () => {
    const target = canonicalRedirect("/", { s: ["likely", "increased"], asof: "2026-01-05" }, { asof: "2026-01-05", s: "likely,increased" })!;
    const sp = Object.fromEntries(new URL(target, "http://x").searchParams);
    expect(canonicalRedirect("/", sp, { asof: "2026-01-05", s: "likely,increased" })).toBeNull();
    expect(hrefWith("/", { asof: null, s: null })).toBe("/");
  });
});
