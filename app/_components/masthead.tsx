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

// First screen (design IA3, radar redesign stage 1). Everything except the date control renders
// from release metadata only, so a rewound page carries nothing published after asOf (A12).
export function Masthead({ release, asOf, isDefault, notice, action, keep = {}, backQuery }: Props) {
  return (
    <header className="masthead">
      <div className="brand-row">
        <p className="wordmark">
          <Link href="/">
            Kapital<span>radar</span>
          </Link>
        </p>
        <p className="descriptor">Swiss capital increases, read from the official gazette and scored for financing rounds.</p>
      </div>
      <p className="status-line">
        <span className="live">updated every weekday</span>
        <span>release {release.id}</span>
        <span>data as of {formatDate(release.snapshotDate)}</span>
      </p>
      {featuredRewind.asOf >= release.backfillStart && featuredRewind.asOf <= release.snapshotDate && (
        <Link className="rewind" href={hrefWith(`/c/${featuredRewind.uid}`, { asof: featuredRewind.asOf })}>
          ↺ {featuredRewindText()}
        </Link>
      )}
      <div className="published-by-bar">
        <form className="published-by" method="get" action={action}>
          <label htmlFor="asof">Published by</label>
          <input id="asof" name="asof" type="date" defaultValue={asOf} min={release.backfillStart} max={release.snapshotDate} required />
          {Object.entries(keep).flatMap(([name, values]) => values.map((v) => <input key={`${name}-${v}`} type="hidden" name={name} value={v} />))}
          <button className="button" type="submit">
            Show
          </button>
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
