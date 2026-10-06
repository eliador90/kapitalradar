// Early redirect to the preview gate (design D4). Not a security boundary: every data reader
// calls assertPreviewAccess() again (eng delta V9). Also forwards the request path so
// not-found.tsx can name the UID and date it was asked about (DT6).
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER } from "./app/_lib/request-path";
import { hasPreviewAccess, PREVIEW_COOKIE, PREVIEW_LOGIN_PATH, PREVIEW_PATH } from "./lib/preview-gate";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isGate = pathname === PREVIEW_PATH || pathname === PREVIEW_LOGIN_PATH;
  if (!isGate && !hasPreviewAccess(request.cookies.get(PREVIEW_COOKIE)?.value)) {
    const url = request.nextUrl.clone();
    url.pathname = PREVIEW_PATH;
    url.search = "";
    if (pathname !== "/" || search) url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url, 303);
  }
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$|robots\\.txt$).*)"],
};
