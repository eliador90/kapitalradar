import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readCompany } from "../../../lib/data/readers";
import { capitalSeries } from "../../../lib/domain/capital-series";
import type { CapitalChangePayload } from "../../../lib/domain/events";
import { resolveAsOf } from "../../../lib/domain/asof";
import { formatDate, formatLegalForm } from "../../../lib/domain/format";
import { formatUid, isCanonicalUid, uidFromPathSegment } from "../../../lib/domain/uid";
import { CapitalChart } from "../../_components/capital-chart";
import { Masthead } from "../../_components/masthead";
import { ConfirmationEntry, RecordEntry } from "../../_components/record-entry";
import { statusTone } from "../../_components/status";
import { canonicalRedirect, getRelease, hrefWith } from "../../_lib/release";

const VISIBLE_ENTRIES = 12;

type Props = { params: Promise<{ uid: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// One chronological record (CEO review E1, design IA6), ending at the red asOf cut line. A UID
// with nothing published by asOf gets the same 404 as an unknown UID (eng delta A11).
export default async function CompanyPage({ params, searchParams }: Props) {
  const [{ uid: raw }, sp] = await Promise.all([params, searchParams]);
  const release = await getRelease();
  const uid = uidFromPathSegment(raw);
  if (!uid) notFound();
  const resolved = resolveAsOf(sp.asof, release);
  const path = `/c/${uid}`;
  if (resolved.notice === "malformed") redirect(hrefWith(path, { notice: "malformed" }));
  const { asOf, isDefault } = resolved;
  const asof = isDefault ? null : asOf;
  const keepNotice = sp.notice === "malformed" && !sp.asof ? "malformed" : null;
  const notice = resolved.notice ?? keepNotice;
  if (!resolved.notice) {
    const canonical = isCanonicalUid(raw) ? canonicalRedirect(path, sp, { asof, notice: keepNotice }) : hrefWith(path, { asof, notice: keepNotice });
    if (canonical) redirect(canonical);
  } else if (!isCanonicalUid(raw)) redirect(hrefWith(path, { asof: typeof sp.asof === "string" ? sp.asof : null }));

  const record = await readCompany(release, uid, asOf);
  if (!record) notFound();

  const items = [
    ...record.entries.map((e) => ({ date: e.publishedAt, node: <RecordEntry key={e.eventId} e={e} config={release.config} /> })),
    ...record.confirmations.map((c, i) => ({ date: c.publishedAt, node: <ConfirmationEntry key={`c${i}`} c={c} /> })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const series = capitalSeries(
    record.entries
      .filter((e) => e.type === "capital_change")
      .map((e) => ({
        publishedAt: e.publishedAt,
        currency: e.currency,
        capitalBefore: e.capitalBefore,
        capitalAfter: e.capitalAfter,
        classesAfter: (e.payload as CapitalChangePayload).classesAfter,
        // Steps outside the assessed window get a hollow marker, not a tier colour.
        tone: !e.status ? null : e.status.state === "not_assessed" ? "none" : statusTone(e.status),
      })),
  );
  const earlier = items.length > VISIBLE_ENTRIES ? items.slice(0, items.length - VISIBLE_ENTRIES) : [];
  const recent = items.slice(earlier.length);

  return (
    <>
      <Masthead release={release} asOf={asOf} isDefault={isDefault} notice={notice} action={path} backQuery={{ asof }} />
      <main id="record">
        <p>
          <Link className="back" href={hrefWith("/", { asof })}>
            ← Back to the feed
          </Link>
        </p>

        <h1 className="headline" lang={record.language ?? undefined}>
          {record.name}
        </h1>
        <p className="coverage">{record.coverage}</p>

        <dl className="summary">
          <dt>UID</dt>
          <dd className="mono">{formatUid(record.uid)}</dd>
          <dt>Legal form</dt>
          <dd>{record.legalForm ? formatLegalForm(record.legalForm) : "—"}</dd>
          <dt>Canton</dt>
          <dd>{record.canton ?? "—"}</dd>
          <dt>Founded</dt>
          <dd className="mono">{record.foundedOn ? formatDate(record.foundedOn) : "not in the record"}</dd>
          <dt>Amount raised</dt>
          <dd>not in the SHAB</dd>
          <dt>Lead investor</dt>
          <dd>not in the SHAB</dd>
        </dl>

        {series && (
          <CapitalChart series={series} asOf={asOf} announcements={record.confirmations.map((c) => c.publishedAt)} lang={record.language ?? undefined} />
        )}

        <h2 className="sr-only">Record</h2>
        {earlier.length > 0 && (
          <details className="earlier">
            <summary>Show {earlier.length} earlier entries</summary>
            <ol className="record">{earlier.map((i) => i.node)}</ol>
          </details>
        )}
        <ol className="record">{recent.map((i) => i.node)}</ol>

        <hr className="cut-line" />
        <p className="cut-label">Published by {formatDate(asOf)}</p>
        {!isDefault && (
          <p>
            <Link className="back" href={path}>
              Latest available record · {formatDate(release.snapshotDate)}
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
