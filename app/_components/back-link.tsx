import Link from "next/link";
import { resolveAsOf } from "../../lib/domain/asof";
import { parseCanton } from "../../lib/domain/cantons";
import { formatDate } from "../../lib/domain/format";
import { feedFilterParam, parseFeedFilters } from "../../lib/domain/status";
import { hrefWith, type PageRelease } from "../_lib/release";

type SearchParams = Record<string, string | string[] | undefined>;

/** The feed's asof, filters and canton, validated and canonical, for links between non-rewinding pages. */
export function backQuery(release: PageRelease, sp: SearchParams) {
  const { asOf, isDefault } = resolveAsOf(sp.asof, release);
  return { asof: isDefault ? null : asOf, s: feedFilterParam(parseFeedFilters(sp.s).filters), c: parseCanton(sp.c), asOf };
}

// "← Back to <asOf date>" on the pages that do not rewind (design J2), keeping asof and filters.
export function BackLink({ release, sp }: { release: PageRelease; sp: SearchParams }) {
  const { asof, s, c, asOf } = backQuery(release, sp);
  return (
    <p>
      <Link className="back" href={hrefWith("/", { asof, s, c })}>
        ← Back to {formatDate(asOf)}
      </Link>
    </p>
  );
}
