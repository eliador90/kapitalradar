// The as-of rule (design IA1, eng delta A14): a row is visible at `asOf` iff it belongs to
// the request's release and its `published_at` (a date) is on or before `asOf`, inclusive.
// `asOf` defaults to, and is clamped at, the release's snapshot date.
import { formatDate } from "./format";
import { isIsoDate } from "./dates";

export interface ReleaseWindow {
  /** First publication day the backfill covers. */
  backfillStart: string;
  /** `releases.snapshot_date`: the last SHAB publication day the release covers. */
  snapshotDate: string;
}

export type AsOfNotice = "clamped_latest" | "clamped_earliest" | "malformed";

export interface ResolvedAsOf {
  asOf: string;
  /** True when the URL carried no asof; canonical URLs then omit it. */
  isDefault: boolean;
  notice: AsOfNotice | null;
}

export function resolveAsOf(raw: string | string[] | undefined, w: ReleaseWindow): ResolvedAsOf {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return { asOf: w.snapshotDate, isDefault: true, notice: null };
  if (!isIsoDate(value)) return { asOf: w.snapshotDate, isDefault: true, notice: "malformed" };
  if (value > w.snapshotDate) return { asOf: w.snapshotDate, isDefault: false, notice: "clamped_latest" };
  if (value < w.backfillStart) return { asOf: w.backfillStart, isDefault: false, notice: "clamped_earliest" };
  return { asOf: value, isDefault: value === w.snapshotDate, notice: null };
}

/** The visibility predicate in memory; SQL readers use the same rule (db/predicates.ts). */
export const isVisibleAt = (publishedAt: string, asOf: string) => publishedAt <= asOf;

export function asOfNoticeText(notice: AsOfNotice, asOf: string): string {
  switch (notice) {
    case "clamped_latest":
      return `Showing ${formatDate(asOf)}, the latest date in this release.`;
    case "clamped_earliest":
      return `Showing ${formatDate(asOf)}, the earliest date in this release.`;
    case "malformed":
      return "That date couldn't be read. Showing the latest available record.";
  }
}
