import Link from "next/link";
import type { FeedRow } from "../../lib/data/readers";
import { formatAmount, formatDate, formatMoney, formatPercent } from "../../lib/domain/format";
import { httpsUrl, publicationUrl } from "../../lib/domain/shab-link";
import { StatusLabel } from "./status";

const PURPOSE_CHARS = 110;
const clip = (s: string) => (s.length > PURPOSE_CHARS ? `${s.slice(0, PURPOSE_CHARS).replace(/\s+\S*$/, "")} …` : s);

function Capital({ row }: { row: FeedRow }) {
  if (!row.capitalBefore || !row.capitalAfter) return <>—</>;
  const currency = row.currency && row.currency !== "CHF" ? `${row.currency} ` : "";
  return (
    <>
      <span className="nowrap">
        {currency}
        {formatAmount(row.capitalBefore)} →
      </span>{" "}
      <span className="nowrap">{formatAmount(row.capitalAfter)}</span>
    </>
  );
}

function Issuance({ row }: { row: FeedRow }) {
  const i = row.issuance;
  return i.kind === "figure" ? (
    <>{formatPercent(i.fraction)}</>
  ) : (
    <>
      — <span className="sub">{i.reason}</span>
    </>
  );
}

function AnnouncedRound({ row }: { row: FeedRow }) {
  const r = row.announcedRound;
  if (!r) return <>—</>;
  const text = r.statedAmount ? formatMoney(r.statedAmount, r.statedCurrency ?? "CHF") : "Announced";
  const href = httpsUrl(r.url);
  return href ? (
    <a href={href} rel="noopener noreferrer" target="_blank">
      {text} ↗
    </a>
  ) : (
    <>{text}</>
  );
}

// One ledger row (design AS2, IA2): no box, the company name and the SHAB link are separate links.
export function LedgerRow({ row, companyHref }: { row: FeedRow; companyHref: string }) {
  const shab = (
    <a className="shab-link" href={publicationUrl(row.publicationId)} rel="noopener noreferrer" target="_blank">
      <span aria-hidden="true">SHAB ↗</span>
      <span className="sr-only">SHAB publication {row.publicationNumber}</span>
    </a>
  );
  const sub = [row.canton, row.purpose ? clip(row.purpose) : null].filter(Boolean);
  return (
    <tr role="row">
      <td role="cell" className="company">
        <Link href={companyHref} lang={row.language}>
          {row.companyName}
        </Link>
        {sub.length > 0 && (
          <span className="sub purpose" lang={row.language}>
            {sub.join(" · ")}
          </span>
        )}
        <span className="inline-secondary">{shab}</span>
      </td>
      <td role="cell" className="col-status">
        <StatusLabel status={row.status} />
        {row.announcedRound && (
          <span className="inline-secondary sub">
            Announced round: <AnnouncedRound row={row} />
          </span>
        )}
      </td>
      <td role="cell" className="num col-capital">
        <Capital row={row} />
        <span className="inline-secondary sub">
          New shares <Issuance row={row} />
        </span>
      </td>
      <td role="cell" className="num col-shares">
        <Issuance row={row} />
      </td>
      <td role="cell" className="col-round">
        <AnnouncedRound row={row} />
      </td>
      <td role="cell" className="num col-date">{formatDate(row.publishedAt)}</td>
      <td role="cell" className="col-source source">{shab}</td>
    </tr>
  );
}
