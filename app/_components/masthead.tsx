import Link from "next/link";
import { asOfNoticeText, type AsOfNotice } from "../../lib/domain/asof";
import { evalLine } from "../../lib/domain/eval-result";
import { featuredRewind, featuredRewindText } from "../../lib/domain/featured";
import { formatDate } from "../../lib/domain/format";
import { hrefWith, type PageRelease } from "../_lib/release";

interface Props {
  release: PageRelease;
  asOf: string;
  isDefault: boolean;
  notice: AsOfNotice | null;
  /** Where the "Published by" form submits (the current route). */
  action: string;
  /** Extra GET parameters the form keeps (filters). */
  keep?: Record<string, string[]>;
  /** Query that links into /methodology carry so they can offer "← Back to <date>". */
  backQuery: Record<string, string | null>;
}

// First screen, in order (design IA3). Everything except the control renders from release
// metadata only, so a rewound page carries nothing published after asOf (eng delta A12).
export function Masthead({ release, asOf, isDefault, notice, action, keep = {}, backQuery }: Props) {
  return (
    <header className="masthead">
      <p className="wordmark">
        <Link href="/">Kapitalradar</Link>
      </p>
      <p className="descriptor">Swiss capital increases, classified with evidence from the official gazette.</p>
      {featuredRewind.asOf >= release.backfillStart && featuredRewind.asOf <= release.snapshotDate && (
        <p>
          <Link href={hrefWith(`/c/${featuredRewind.uid}`, { asof: featuredRewind.asOf })}>{featuredRewindText()} ↗</Link>
        </p>
      )}
      <div className="published-by-bar">
        <form className="published-by" method="get" action={action}>
          <label htmlFor="asof">Published by</label>
          <input id="asof" name="asof" type="date" defaultValue={asOf} min={release.backfillStart} max={release.snapshotDate} required />
          {Object.entries(keep).flatMap(([name, values]) => values.map((v) => <input key={`${name}-${v}`} type="hidden" name={name} value={v} />))}
          <button className="button" type="submit">
            Show
          </button>
          <span className="release-line">
            release {release.id} · data as of {formatDate(release.snapshotDate)}
          </span>
          {!isDefault && (
            <Link className="back" href={hrefWith(action, { s: keep.s?.join(",") })}>
              Latest available record · {formatDate(release.snapshotDate)}
            </Link>
          )}
        </form>
        {notice && (
          <p className="notice" role="status">
            {asOfNoticeText(notice, asOf)}
          </p>
        )}
      </div>
      {release.evaluation && (
        <p className="eval-line">
          {evalLine(release.evaluation)} · <Link href={hrefWith("/methodology", backQuery)}>Methodology</Link>
        </p>
      )}
    </header>
  );
}
