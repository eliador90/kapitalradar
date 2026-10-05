// Polite HTTP for external sources: browser headers, a per-host minimum interval, and
// retries with exponential backoff. Every failure throws with the URL and status; nothing
// is swallowed.

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const lastRequestAt = new Map<string, number>();
let rateLimited = 0;

/** HTTP 429 responses seen (and retried) in this process. */
export const rateLimitedCount = () => rateLimited;

export interface PoliteFetchOptions {
  /** Minimum milliseconds between requests to the same host. */
  minIntervalMs?: number;
  retries?: number;
  /** Statuses returned to the caller instead of thrown (e.g. 404 meaning "no match"). */
  passStatuses?: number[];
  init?: RequestInit;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function politeFetch(url: string, opts: PoliteFetchOptions = {}): Promise<Response> {
  const { minIntervalMs = 1000, retries = 3, init = {}, passStatuses = [] } = opts;
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const wait = (lastRequestAt.get(host) ?? 0) + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt.set(host, Date.now());
    let res: Response | undefined;
    let error: unknown;
    try {
      res = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en,de;q=0.8,fr;q=0.6", ...init.headers },
      });
    } catch (e) {
      error = e;
    }
    if (res && (res.ok || passStatuses.includes(res.status))) return res;
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (res?.status === 429) rateLimited++;
    const reason = res ? `HTTP ${res.status}` : String(error);
    if (!retryable || attempt >= retries) throw new Error(`fetch failed: ${url} → ${reason}`);
    console.warn(`[http] retry ${attempt + 1}/${retries} after ${reason}: ${url}`);
    await sleep(2 ** attempt * 2000);
  }
}

export async function fetchText(url: string, opts?: PoliteFetchOptions): Promise<string> {
  return (await politeFetch(url, opts)).text();
}

export async function fetchJson(url: string, opts?: PoliteFetchOptions): Promise<unknown> {
  const res = await politeFetch(url, {
    ...opts,
    init: { ...opts?.init, headers: { Accept: "application/json", ...opts?.init?.headers } },
  });
  return res.json();
}
