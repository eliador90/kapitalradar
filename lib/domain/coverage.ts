// What a company page's record covers (design ST1 "Partial history"; plan T5 fallback chain:
// SHAB by UID → Zefix's dated references → backfill window only, labeled partial).
import { formatDate } from "./format";

export interface SourceCoverage {
  formationFound: boolean;
  foundedOn: string | null;
  earliestShabPublished: string | null;
  /** Earliest Zefix reference date, when the fallback ran and answered. */
  earliestZefixRef: string | null;
  /** True when both history routes failed and only the backfill window is known. */
  historyLookupFailed: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export function coverageLine(c: SourceCoverage, backfillStart: string): string {
  if (c.historyLookupFailed) return `Partial history: ${monthYear(backfillStart)} onward only`;
  if (c.formationFound && c.foundedOn) return `History from ${formatDate(c.foundedOn)}`;
  const earliest = [c.earliestShabPublished, c.earliestZefixRef].filter((d): d is string => d !== null).sort()[0];
  return earliest ? `History from ${formatDate(earliest)}` : `Partial history: ${monthYear(backfillStart)} onward only`;
}

/** Company age bucket for the age rule (eng Q4): unknown without a founding date. */
export type AgeBucket = "under_2" | "2_to_6" | "6_plus" | "unknown";

/** Whole calendar years from `from` to `to` (both ISO dates): an anniversary counts on the day. */
export function calendarYears(from: string, to: string): number {
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return to.slice(5) >= from.slice(5) ? years : years - 1;
}

export function ageBucket(foundedOn: string | null, at: string): AgeBucket {
  if (!foundedOn || at < foundedOn) return "unknown";
  const years = calendarYears(foundedOn, at);
  return years < 2 ? "under_2" : years < 6 ? "2_to_6" : "6_plus";
}

/** company_sources row → coverage facts (plan T5 fallback chain). */
export function coverageFromSources(row: {
  formationFound: boolean;
  foundedOn: string | null;
  earliestShabPublished: string | null;
  zefixRefs: { date: string }[];
  zefixError: string | null;
}): SourceCoverage {
  const earliestZefixRef = row.zefixRefs.map((r) => r.date).sort()[0] ?? null;
  return {
    formationFound: row.formationFound,
    foundedOn: row.foundedOn,
    earliestShabPublished: row.earliestShabPublished,
    earliestZefixRef,
    // Both routes gave nothing beyond the backfill window.
    historyLookupFailed: !row.formationFound && earliestZefixRef === null && row.zefixError !== null,
  };
}
