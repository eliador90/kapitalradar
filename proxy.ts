// Forwards the request path so not-found.tsx can name the UID and date it was asked about (DT6).
// The site is public (decision log #50): there is no access gate.
import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER } from "./app/_lib/request-path";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // The former private-preview gate: old links land on the feed.
  if (pathname === "/preview" || pathname === "/preview/login") return NextResponse.redirect(new URL("/", request.url), 308);
  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, pathname + search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static/|_next/image$|favicon\\.ico$|robots\\.txt$).*)"],
};
