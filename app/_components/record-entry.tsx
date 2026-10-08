import type { CompanyRecord } from "../../lib/data/readers";
import type { CapitalChangePayload } from "../../lib/domain/events";
import { formatAmount, formatCount, formatDate, formatLegalForm, formatPercent } from "../../lib/domain/format";
import type { ReleaseConfig } from "../../lib/domain/schemas";
import { httpsUrl, publicationUrl } from "../../lib/domain/shab-link";
import { StatusLabel } from "./status";

type Entry = CompanyRecord["entries"][number];

const CONTRIBUTION: Record<string, string> = {
  cash: "Paid in cash",
  set_off: "Paid by converting claims",
  in_kind: "Paid in kind",
  mixed: "Paid in cash and by other means",
  conditional_capital: "Issued from conditional capital",
  unknown: "Payment not stated",
};

function title(e: Entry): string {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "capital_change": {
      const c = p as unknown as CapitalChangePayload;
      if (c.restructuringPair) return "Capital reduced and re-increased";
      if (c.withConversion) return "Capital set in the conversion to an AG";
      return c.direction === "reduction" ? "Capital reduction" : c.direction === "increase" ? "Capital increase" : "Capital restated";
    }
    case "conversion_to_ag":
      return "Converted to an AG";
    case "capital_band":
      return `Capital band ${String(p.action)}`;
    case "formation":
      return "Company formed";
    case "name_change":
      return "Name changed";
    default:
      return e.type;
  }
}

function Evidence({ e, config }: { e: Entry; config: ReleaseConfig }) {
  const ev = e.evidence;
  if (!ev) return null;
  const display = new Map(config.rules.map((r) => [r.id, r.display]));
  return (
    <div className="evidence">
      {ev.ruleHits.length > 0 && (
        <ul>
          {ev.ruleHits.map((id) => (
            <li key={id}>{display.get(id) ?? id}</li>
          ))}
        </ul>
      )}
      {ev.rejectReason ? (
        <p className="secondary">Not sent to the classifier: {ev.rejectReason.replace(/_/g, " ")}.</p>
      ) : ev.score !== null ? (
        <p className="mono">
          Classifier score {ev.score.toFixed(2)} · likely-financing threshold {config.tau.toFixed(2)} · not a calibrated probability
        </p>
      ) : (
        <p className="secondary">No classifier score for this step.</p>
      )}
    </div>
  );
}

const LANGUAGE: Record<string, string> = { de: "German", fr: "French", it: "Italian", rm: "Romansh", en: "English" };

/**
 * The gazette's own words for this step, kept visually apart from our reading of it (SHAB terms
 * of use §3.3: unchanged data separate from own comments, source named, not an official copy).
 */
function Excerpt({ e }: { e: Entry }) {
  const text = (e.payload as { excerpt?: string | null }).excerpt;
  if (!text) return null;
  return (
    <figure className="excerpt">
      <blockquote lang={e.language} cite={publicationUrl(e.publicationId)}>
        <p>{text}</p>
      </blockquote>
      <figcaption>
        From the SHAB entry · {LANGUAGE[e.language] ?? "original"} original, person names removed · not an official copy ·{" "}
        <a href={publicationUrl(e.publicationId)} rel="noopener noreferrer" target="_blank">
          full entry ↗
        </a>
      </figcaption>
    </figure>
  );
}

function Figures({ e }: { e: Entry }) {
  if (e.type === "capital_change") {
    const c = e.payload as CapitalChangePayload;
    const classes = c.classesAfter && c.classesAfter.length > 1 ? c.classesAfter : null;
    return (
      <dl className="figures">
        <dt>Nominal capital</dt>
        <dd className="num">
          {e.capitalBefore && e.capitalAfter ? `${formatAmount(e.capitalBefore)} → ${formatAmount(e.capitalAfter)}` : "—"}
        </dd>
        <dt>Shares</dt>
        <dd className="num">
          {e.sharesBefore !== null ? formatCount(e.sharesBefore) : "—"} → {e.sharesAfter !== null ? formatCount(e.sharesAfter) : "—"}
        </dd>
        <dt>New shares, % of post-step shares</dt>
        <dd className="num">
          {e.issuance?.kind === "figure" ? `${formatPercent(e.issuance.fraction)} (${formatCount(e.issuance.newShares)} new)` : `— (${e.issuance?.reason ?? "not computed"})`}
        </dd>
        {classes && (
          <>
            <dt>Share classes</dt>
            <dd lang={e.language}>
              {classes.map((k) => `${formatCount(k.count)} × ${k.currency} ${formatAmount(k.nominal)}${k.label ? ` ${k.label}` : ""}`).join(" · ")}
            </dd>
          </>
        )}
      </dl>
    );
  }
  const p = e.payload as Record<string, string>;
  if (e.type === "name_change")
    return (
      <p lang={e.language}>
        {p.from} → {p.to}
      </p>
    );
  if (e.type === "conversion_to_ag") return <p>{`${formatLegalForm(p.fromLegalForm ?? "")} → ${formatLegalForm(p.toLegalForm ?? "")}`}</p>;
  if (e.type === "formation" && p.foundedOn) return <p>Founded {formatDate(p.foundedOn)}</p>;
  return null;
}

// One dated entry of the chronological record (design IA6, ST2).
export function RecordEntry({ e, config }: { e: Entry; config: ReleaseConfig }) {
  const contribution = e.contributionType ? CONTRIBUTION[e.contributionType] : undefined;
  return (
    <li className="entry">
      <p className="entry-date">
        SHAB published {formatDate(e.publishedAt)}
        {e.legalDate !== e.publishedAt && ` · legal date ${formatDate(e.legalDate)}`}
      </p>
      <h3>{title(e)}</h3>
      {e.status && <StatusLabel status={e.status} />}
      {contribution && <p className="secondary">{contribution}</p>}
      <Figures e={e} />
      <Excerpt e={e} />
      {e.corrects && <p className="secondary">Corrects SHAB {e.corrects}</p>}
      {e.correctedOn && <p className="secondary">Corrected on {formatDate(e.correctedOn)} ↓</p>}
      <Evidence e={e} config={config} />
      <a className="shab-link" href={publicationUrl(e.publicationId)} rel="noopener noreferrer" target="_blank">
        SHAB {e.publicationNumber} ↗
      </a>
    </li>
  );
}

export function ConfirmationEntry({ c }: { c: CompanyRecord["confirmations"][number] }) {
  // eventMatch is null while the matched entry is not yet published at asOf: reads as not matched.
  const match = c.eventMatch === "accepted" ? "matched to a capital increase" : c.eventMatch === "uncertain" ? "possible match" : "not matched";
  return (
    <li className="entry">
      <p className="entry-date">Announced {formatDate(c.publishedAt)}</p>
      <h3>Round announced</h3>
      <p className="secondary">
        {match} · {c.matchConfidence} match confidence{c.reviewed ? " · reviewed" : ""}
      </p>
      {httpsUrl(c.sourceUrl) && (
        <a className="shab-link" href={httpsUrl(c.sourceUrl)!} rel="noopener noreferrer" target="_blank">
          Announcement ↗
        </a>
      )}
    </li>
  );
}
