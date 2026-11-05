// The readers behind Next's Data Cache, so most requests never wake the database (decision log
// #52). A release is immutable, so rows keyed by release id stay correct and never expire: a new
// release changes the key. Only the pointer to the current release expires, once a day.
import { unstable_cache } from "next/cache";
import { readCantonCounts, readCompany, readCurrentRelease, readDailySeries, readFeedWeek, type ReleaseKey, type ReleaseMeta } from "./readers";

/** How long the site may keep serving the previous release after the pointer flips. */
const POINTER_TTL_SECONDS = 24 * 60 * 60;
/** `vercel cache invalidate --tag current-release` makes a rollback show on the next requests. */
const CURRENT_RELEASE_TAG = "current-release";

// A new commit starts empty: a changed reader must not serve rows in an old shape. Next's own key
// covers the reader's source text but not the helpers it calls.
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

export const cachedCurrentRelease = unstable_cache(
  async (): Promise<ReleaseMeta> => {
    const release = await readCurrentRelease();
    // A throw is never cached, unlike a null.
    if (!release) throw new Error("no current release: build and activate one with scripts/build-release.ts");
    return release;
  },
  [BUILD, CURRENT_RELEASE_TAG],
  { revalidate: POINTER_TTL_SECONDS, tags: [CURRENT_RELEASE_TAG] },
);

const byRelease = <A extends unknown[], R>(name: string, read: (release: ReleaseKey, ...args: A) => Promise<R>) => {
  const cached = unstable_cache(read, [BUILD, name], { revalidate: false });
  // The arguments are the cache key: only the fields that identify the release, not its config.
  return ({ id, backfillStart }: ReleaseKey, ...args: A) => cached({ id, backfillStart }, ...args);
};

export const cachedDailySeries = byRelease("daily-series", readDailySeries);
export const cachedCantonCounts = byRelease("canton-counts", readCantonCounts);
export const cachedFeedWeek = byRelease("feed-week", readFeedWeek);
// A null is cached too: within one release, a UID with nothing published by asOf stays that way.
export const cachedCompany = byRelease("company", readCompany);
