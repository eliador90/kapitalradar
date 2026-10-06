// POST /preview/login: checks the password, sets the signed cookie, redirects to `next` (DT8).
import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, issueToken, passwordMatches, PREVIEW_COOKIE, PREVIEW_PATH, previewConfig, PreviewConfigError, safeNext } from "../../../lib/preview-gate";

const MAX_PASSWORD_LENGTH = 512;

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  const next = safeNext(typeof form?.get("next") === "string" ? (form.get("next") as string) : null);
  let cfg;
  try {
    cfg = previewConfig();
  } catch (e) {
    if (!(e instanceof PreviewConfigError)) throw e;
    console.error(`[preview-gate] login refused: ${e.message}`);
    return new NextResponse("The preview is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const ok = typeof password === "string" && password.length <= MAX_PASSWORD_LENGTH && passwordMatches(password, cfg);
  const target = new URL(ok ? next : PREVIEW_PATH, request.nextUrl.origin);
  if (!ok) {
    target.searchParams.set("error", "1");
    if (next !== "/") target.searchParams.set("next", next);
  }
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  if (ok) response.cookies.set(PREVIEW_COOKIE, issueToken(cfg), cookieOptions);
  return response;
}
