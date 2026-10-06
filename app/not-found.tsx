import { headers } from "next/headers";
import Link from "next/link";
import { resolveAsOf } from "../lib/domain/asof";
import { formatDate } from "../lib/domain/format";
import { formatUid, uidFromPathSegment } from "../lib/domain/uid";
import { getRelease, hrefWith } from "./_lib/release";
import { REQUEST_PATH_HEADER } from "./_lib/request-path";

// One 404 for an unknown UID and for a UID with nothing published by asOf, identical in status
// and body: the UID only, no name, no count (eng delta A11, design ST1).
export default async function NotFound() {
  const release = await getRelease();
  const path = new URL((await headers()).get(REQUEST_PATH_HEADER) ?? "/", "http://x.invalid");
  const match = /^\/c\/([^/]+)\/?$/.exec(path.pathname);
  const uid = match ? uidFromPathSegment(match[1]!) : null;
  const { asOf, isDefault } = resolveAsOf(path.searchParams.get("asof") ?? undefined, release);
  const asof = isDefault ? null : asOf;
  return (
    <main id="record" className="reading">
      <h1 className="headline">Not in the record</h1>
      <p>
        {uid
          ? `No SHAB publication for UID ${formatUid(uid)} by ${formatDate(asOf)} in release ${release.id}.`
          : match
            ? `That is not a Swiss UID. No SHAB publication by ${formatDate(asOf)} in release ${release.id}.`
            : "There is no page at this address."}
      </p>
      <p>
        <Link className="back" href={uid ? `/c/${uid}` : "/"}>
          Latest available record · {formatDate(release.snapshotDate)}
        </Link>
      </p>
      <p>
        <Link className="back" href={hrefWith("/", { asof })}>
          Back to the feed
        </Link>
      </p>
    </main>
  );
}
