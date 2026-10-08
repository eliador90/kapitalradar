import Link from "next/link";
import { redirect } from "next/navigation";
import { readCantonCounts, readDailySeries, readFeedWeek } from "../lib/data/readers";
import { resolveAsOf } from "../lib/domain/asof";
import { MAP_WINDOW_DAYS, parseCanton } from "../lib/domain/cantons";
import { addDays, maxDate } from "../lib/domain/dates";
import { formatDateRange } from "../lib/domain/format";
import { FEED_FILTERS, feedFilterOf, feedFilterParam, feedFilterPhrase, parseFeedFilters } from "../lib/domain/status";
import { nextWeekAsOf, previousWeekAsOf, weekOf } from "../lib/domain/week";
import { LedgerRow } from "./_components/ledger-row";
import { Masthead } from "./_components/masthead";
import { RadarMap } from "./_components/radar-map";
import { StatusLegend } from "./_components/status-legend";
import { Timeline } from "./_components/timeline";
import { canonicalRedirect, getRelease, hrefWith } from "./_lib/release";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// The feed (design IA3, IA4/D7): the Monday–Sunday week containing asOf, capped at asOf.
export default async function FeedPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const release = await getRelease();
  const { filters } = parseFeedFilters(sp.s);
  const s = feedFilterParam(filters);
  const c = parseCanton(sp.c);
  const resolved = resolveAsOf(sp.asof, release);
  if (resolved.notice === "malformed") redirect(hrefWith("/", { s, c, notice: "malformed" }));
  const notice = resolved.notice ?? (sp.notice === "malformed" ? "malformed" : null);
  const { asOf, isDefault } = resolved;
  const asof = isDefault ? null : asOf;
  const keepNotice = sp.notice === "malformed" && !sp.asof ? "malformed" : null;
  if (!resolved.notice) {
    const canonical = canonicalRedirect("/", sp, { asof, s, c, notice: keepNotice });
    if (canonical) redirect(canonical);
  }

  // The first week may start before the backfill: the record covers only [backfillStart, asOf].
  const week = weekOf(asOf);
  const start = maxDate(week.start, release.backfillStart);
  const range = formatDateRange(start, week.end);
  const mapFrom = maxDate(addDays(asOf, 1 - MAP_WINDOW_DAYS), release.backfillStart);
  const [weekRows, series, cantonCounts] = await Promise.all([
    readFeedWeek(release, asOf, start, week.end),
    readDailySeries(release, asOf),
    readCantonCounts(release, asOf, mapFrom),
  ]);
  const rows = c ? weekRows.filter((r) => r.canton === c) : weekRows;
  const shown = rows.filter((r) => filters.includes(feedFilterOf(r.status, r.tier)));
  const others = rows.length - shown.length;
  const prev = previousWeekAsOf(asOf, release.backfillStart);
  const next = nextWeekAsOf(asOf, release.snapshotDate);
  const weekHref = (d: string) => hrefWith("/", { asof: d === release.snapshotDate ? null : d, s, c });
  const cantonHref = (canton: string | null) => `${hrefWith("/", { asof, s, c: canton })}#radar`;
  const companyHref = (uid: string) => hrefWith(`/c/${uid}`, { asof });
  const filterLabel = feedFilterPhrase(filters, "and");

  return (
    <>
      <Masthead release={release} asOf={asOf} isDefault={isDefault} notice={notice} action="/" keep={{ ...(s ? { s: [s] } : {}), ...(c ? { c: [c] } : {}) }} backQuery={{ asof, s, c }} />
      <Timeline series={series} asOf={asOf} backfillStart={release.backfillStart} snapshotDate={release.snapshotDate} keep={{ s, c }} />
      <div className="scope-row">
        <RadarMap counts={cantonCounts} from={mapFrom} asOf={asOf} selected={c} hrefFor={cantonHref} />
        <StatusLegend tau={release.config.tau} tauLow={release.config.tauLow} />
      </div>
      <main id="record">
        <div className="window-heading">
          <h1 className="window-title">
            Published {range}
            {c && <span className="muted"> · canton {c}</span>}
          </h1>
          <span className="mono muted">
            {plural(rows.length, "capital increase", "capital increases")} · {shown.length} shown
          </span>
        </div>

        <form method="get" action="/">
          {asof && <input type="hidden" name="asof" value={asof} />}
          {c && <input type="hidden" name="c" value={c} />}
          <details className="filters" open>
            <summary>Showing: {filterLabel} ▾</summary>
            <fieldset className="filter-set">
              <legend>Show</legend>
              {FEED_FILTERS.map((f) => (
                <label key={f.key}>
                  <input type="checkbox" name="s" value={f.key} defaultChecked={filters.includes(f.key)} />
                  {f.label}
                </label>
              ))}
              <button className="button" type="submit">
                Apply
              </button>
            </fieldset>
          </details>
        </form>

        {rows.length === 0 ? (
          <p className="empty">No capital increases were published in the SHAB {range}.</p>
        ) : shown.length === 0 ? (
          <p className="empty">
            No {feedFilterPhrase(filters)} among the {plural(rows.length, "capital increase", "capital increases")} published {range}.{" "}
            <Link href={hrefWith("/", { asof, s: "all", c })}>Show all {rows.length}</Link>
          </p>
        ) : (
          <table className="ledger" role="table">
            <caption className="sr-only">Capital increases published {range}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Company</th>
                <th role="columnheader" scope="col" className="col-status">
                  Status
                </th>
                <th role="columnheader" scope="col" className="num col-capital">
                  Nominal share capital (CHF)
                  <br />
                  before → after
                </th>
                <th role="columnheader" scope="col" className="num col-shares">
                  New shares, % of
                  <br />
                  post-step shares
                </th>
                <th role="columnheader" scope="col" className="col-round">
                  Announced round
                  <span className="sub">not disclosed in the SHAB</span>
                </th>
                <th role="columnheader" scope="col" className="num col-date">
                  SHAB published
                </th>
                <th role="columnheader" scope="col" className="col-source">
                  Source
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {shown.map((r) => (
                <LedgerRow key={r.eventId} row={r} companyHref={companyHref(r.companyUid)} tau={release.config.tau} />
              ))}
            </tbody>
          </table>
        )}

        {others > 0 && shown.length > 0 && (
          <p className="others">
            <Link href={hrefWith("/", { asof, s: "all", c })}>{plural(others, "other capital increase", "other capital increases")} published this week ▸</Link>
          </p>
        )}

        <nav className="week-nav" aria-label="Weeks">
          {prev ? <Link href={weekHref(prev)}>← Previous week</Link> : <span />}
          {next ? <Link href={weekHref(next)}>Next week →</Link> : <span />}
        </nav>
      </main>
    </>
  );
}
