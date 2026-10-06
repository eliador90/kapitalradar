// Route smoke for the preview gate (DT8): proxy redirect, login, forged cookie, noindex.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proxy } from "../../proxy";
import { issueToken, PREVIEW_COOKIE, previewConfig } from "../../lib/preview-gate";
import { POST } from "./login/route";

const ENV = { PREVIEW_PASSWORD: "correct horse battery staple", PREVIEW_COOKIE_SECRET: "s".repeat(40) };
const saved = { ...process.env };
beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
  process.env = { ...saved };
});

const login = (fields: Record<string, string>) => {
  const body = new URLSearchParams(fields);
  return POST(new NextRequest("https://kr.test/preview/login", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }));
};

describe("proxy", () => {
  it("sends a visitor without a cookie to the gate page, keeping where they were going", () => {
    const res = proxy(new NextRequest("https://kr.test/c/CHE123456789?asof=2026-09-01"));
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/preview");
    expect(to.searchParams.get("next")).toBe("/c/CHE123456789?asof=2026-09-01");
  });
  it("rejects a forged cookie", () => {
    const req = new NextRequest("https://kr.test/", { headers: { cookie: `${PREVIEW_COOKIE}=v1.1700000000.forged` } });
    expect(proxy(req).status).toBe(303);
  });
  it("lets a signed cookie through and forwards the request path", () => {
    const token = issueToken(previewConfig());
    const res = proxy(new NextRequest("https://kr.test/c/CHE123456789", { headers: { cookie: `${PREVIEW_COOKIE}=${token}` } }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-kr-path")).toBe("/c/CHE123456789");
  });
  it("never gates the gate itself", () => {
    expect(proxy(new NextRequest("https://kr.test/preview")).headers.get("location")).toBeNull();
  });
});

describe("POST /preview/login", () => {
  it("sets the httpOnly cookie and redirects to a safe next path on the right password", async () => {
    const res = await login({ password: ENV.PREVIEW_PASSWORD, next: "/methodology" });
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/methodology");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${PREVIEW_COOKIE}=v1.`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });
  it("returns to the gate with the error copy and no cookie on a wrong password", async () => {
    const res = await login({ password: "nope", next: "/misses" });
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/preview");
    expect(to.searchParams.get("error")).toBe("1");
    expect(to.searchParams.get("next")).toBe("/misses");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("never redirects off-site", async () => {
    const res = await login({ password: ENV.PREVIEW_PASSWORD, next: "//evil.example/x" });
    expect(new URL(res.headers.get("location")!).origin).toBe("https://kr.test");
  });
  it("fails closed when the preview is not configured", async () => {
    delete process.env.PREVIEW_COOKIE_SECRET;
    const res = await login({ password: ENV.PREVIEW_PASSWORD });
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("noindex", () => {
  it("is sent on every route", async () => {
    const { default: config } = await import("../../next.config");
    const rules = await config.headers!();
    expect(rules).toContainEqual({ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] });
  });
});
