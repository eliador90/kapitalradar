import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COOKIE_MAX_AGE_S,
  hasPreviewAccess,
  issueToken,
  passwordMatches,
  previewConfig,
  safeNext,
  verifyToken,
} from "./preview-gate";

const env = { PREVIEW_PASSWORD: "correct-horse-battery-staple-42", PREVIEW_COOKIE_SECRET: "s".repeat(48) };
const cfg = previewConfig(env);
const NOW = Date.parse("2026-10-05T12:00:00Z");

describe("preview gate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails closed on weak or missing config", () => {
    expect(() => previewConfig({})).toThrow(/PREVIEW_PASSWORD/);
    expect(() => previewConfig({ ...env, PREVIEW_PASSWORD: "short" })).toThrow(/20/);
    expect(() => previewConfig({ ...env, PREVIEW_COOKIE_SECRET: "x" })).toThrow(/SECRET/);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(hasPreviewAccess(issueToken(cfg), {})).toBe(false);
  });

  it("checks the password", () => {
    expect(passwordMatches(env.PREVIEW_PASSWORD, cfg)).toBe(true);
    expect(passwordMatches("correct-horse-battery-staple-43", cfg)).toBe(false);
    expect(passwordMatches("", cfg)).toBe(false);
  });

  it("accepts its own token and rejects forged, tampered and expired ones", () => {
    const token = issueToken(cfg, NOW);
    expect(verifyToken(token, cfg, NOW)).toBe(true);
    expect(verifyToken(undefined, cfg, NOW)).toBe(false);
    expect(verifyToken("v1.1791000000.forged", cfg, NOW)).toBe(false);
    const [v, ts, sig] = token.split(".");
    expect(verifyToken(`${v}.${Number(ts) + 1}.${sig}`, cfg, NOW)).toBe(false); // tampered timestamp
    expect(verifyToken(issueToken({ ...cfg, secret: "o".repeat(48) }, NOW), cfg, NOW)).toBe(false); // other key
    expect(verifyToken(token, cfg, NOW + (COOKIE_MAX_AGE_S + 1) * 1000)).toBe(false); // expired
    expect(hasPreviewAccess(issueToken(cfg), env)).toBe(true);
  });

  it("invalidates tokens when the password rotates", () => {
    const token = issueToken(cfg, NOW);
    expect(verifyToken(token, { ...cfg, password: "another-long-password-0123456" }, NOW)).toBe(false);
  });

  it("never treats the password as the cookie", () => {
    expect(verifyToken(env.PREVIEW_PASSWORD, cfg, NOW)).toBe(false);
  });

  it.each([
    ["/c/CHE123456789?asof=2026-09-01", "/c/CHE123456789?asof=2026-09-01"],
    ["/methodology#top", "/methodology#top"],
    ["https://evil.example/", "/"],
    ["//evil.example/x", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/preview", "/"],
    ["/PREVIEW/", "/"],
    ["/.//evil.example", "/"],
    ["/..//evil.example/x", "/"],
    ["/%2e//evil.example", "/"],
    ["/a/../..//evil.example", "/"],
    [undefined, "/"],
  ])("safeNext(%s) → %s", (input, out) => {
    expect(safeNext(input)).toBe(out);
  });
});
