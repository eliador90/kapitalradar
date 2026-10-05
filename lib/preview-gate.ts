// Private-preview gate (design D4, eng delta A13/V9). The proxy redirects early, but it is not
// a security boundary: every server-side data reader and route handler calls
// assertPreviewAccess(). The cookie is an HMAC-SHA256 token keyed by PREVIEW_COOKIE_SECRET
// (never the password). Misconfiguration fails closed.
import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_COOKIE = "kr_preview";
export const PREVIEW_PATH = "/preview";
export const PREVIEW_LOGIN_PATH = "/preview/login";
export const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
const MIN_PASSWORD_LENGTH = 20;
const MIN_SECRET_LENGTH = 32;
const VERSION = "v1";

export interface PreviewConfig {
  password: string;
  secret: string;
}

export class PreviewConfigError extends Error {}

/** Reads and validates the env; throws (fail closed) when the gate can't be enforced. */
export function previewConfig(env: Record<string, string | undefined> = process.env): PreviewConfig {
  const password = env.PREVIEW_PASSWORD ?? "";
  const secret = env.PREVIEW_COOKIE_SECRET ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PreviewConfigError(`PREVIEW_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new PreviewConfigError(`PREVIEW_COOKIE_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (secret === password) throw new PreviewConfigError("PREVIEW_COOKIE_SECRET must differ from the password");
  return { password, secret };
}

const mac = (secret: string, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/** Constant time regardless of input length: compares HMACs of both strings. */
export function passwordMatches(input: string, cfg: PreviewConfig): boolean {
  return safeEqual(mac(cfg.secret, `pw:${input}`), mac(cfg.secret, `pw:${cfg.password}`));
}

// The token MAC also covers a password fingerprint, so rotating the password logs everyone out.
const tokenMac = (cfg: PreviewConfig, payload: string) => mac(cfg.secret, `${payload}|${mac(cfg.secret, `pwfp:${cfg.password}`)}`);

export function issueToken(cfg: PreviewConfig, nowMs = Date.now()): string {
  const payload = `${VERSION}.${Math.floor(nowMs / 1000)}`;
  return `${payload}.${tokenMac(cfg, payload)}`;
}

export function verifyToken(token: string | undefined, cfg: PreviewConfig, nowMs = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION || !/^\d{1,12}$/.test(parts[1]!)) return false;
  if (!safeEqual(parts[2]!, tokenMac(cfg, `${parts[0]}.${parts[1]}`))) return false;
  const ageS = nowMs / 1000 - Number(parts[1]);
  return ageS >= -60 && ageS <= COOKIE_MAX_AGE_S;
}

const isRelativePath = (p: string) => p.startsWith("/") && !p.startsWith("//") && !/[\\\u0000-\u001f]/.test(p);

/** Relative same-origin paths only; anything else becomes "/". Checked before and after URL normalization. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !isRelativePath(next)) return "/";
  try {
    const u = new URL(next, "http://gate.invalid");
    // Dot segments normalize "/.//evil.example" into "//evil.example": check the result again.
    if (u.origin !== "http://gate.invalid" || !isRelativePath(u.pathname)) return "/";
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (path === PREVIEW_PATH || path === PREVIEW_LOGIN_PATH) return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: COOKIE_MAX_AGE_S,
};

/** Request-independent check, used by the proxy and by assertPreviewAccess. */
export function hasPreviewAccess(cookieValue: string | undefined, env?: Record<string, string | undefined>): boolean {
  let cfg: PreviewConfig;
  try {
    cfg = previewConfig(env);
  } catch (e) {
    console.error(`[preview-gate] denying access: ${(e as Error).message}`);
    return false;
  }
  return verifyToken(cookieValue, cfg);
}

/**
 * Server-side guard for every data reader and route handler (eng delta V9). Redirects to the
 * gate page when the cookie is missing, forged or expired. Imports Next lazily so the pure
 * helpers above stay usable in tests and scripts.
 */
export async function assertPreviewAccess(): Promise<void> {
  const { cookies } = await import("next/headers");
  const value = (await cookies()).get(PREVIEW_COOKIE)?.value;
  if (!hasPreviewAccess(value)) {
    const { redirect } = await import("next/navigation");
    redirect(PREVIEW_PATH);
  }
}
