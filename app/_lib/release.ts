// One release per request (eng delta P4, V13): every page resolves the current release once
// and passes it to each reader, so a page never mixes releases.
import { cache } from "react";
import { readCurrentRelease } from "../../lib/data/readers";
import { parseReleaseEval } from "../../lib/domain/eval-result";

export const getRelease = cache(async () => {
  const release = await readCurrentRelease();
  if (!release) throw new Error("no current release: build and activate one with scripts/build-release.ts");
  return { ...release, evaluation: parseReleaseEval(release.evalResult) };
});

export type PageRelease = Awaited<ReturnType<typeof getRelease>>;

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The canonical href when the request's query differs from it (defaults spelled out, repeated
 * filter params, unknown keys), else null. Callers redirect; never call it while a clamp notice
 * is showing, since the clamped URL is the one that carries the notice.
 */
export function canonicalRedirect(path: string, sp: SearchParams, canonical: Record<string, string | null | undefined>): string | null {
  const incoming = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v === undefined ? [] : [v]) incoming.append(k, x);
  const target = hrefWith(path, canonical);
  const sorted = (q: URLSearchParams) => [...q].map(([k, v]) => `${k}=${v}`).sort().join("&");
  return sorted(incoming) === sorted(new URLSearchParams(target.split("?")[1] ?? "")) ? null : target;
}

/** Builds a URL that keeps asof and filters only when they differ from the defaults (canonical URLs). */
export function hrefWith(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
