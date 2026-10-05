// The feed window (design D7): the Monday–Sunday week containing `asOf`, capped at `asOf`.
import { addDays, isoWeekday, minDate } from "./dates";

export interface WeekWindow {
  monday: string;
  sunday: string;
  /** First visible day (Monday). */
  start: string;
  /** Last visible day: Sunday, or `asOf` when the week is still running at `asOf`. */
  end: string;
}

export function weekOf(asOf: string): WeekWindow {
  const monday = addDays(asOf, -isoWeekday(asOf));
  const sunday = addDays(monday, 6);
  return { monday, sunday, start: monday, end: minDate(sunday, asOf) };
}

/** `asOf` for "← previous week": the Sunday before, or null before the backfill start. */
export function previousWeekAsOf(asOf: string, backfillStart: string): string | null {
  const prev = addDays(weekOf(asOf).monday, -1);
  return prev < backfillStart ? null : prev;
}

/**
 * `asOf` for "next week →": next week's Sunday, capped at the snapshot. Inside the snapshot
 * week it points at the snapshot itself (the rest of the week); null at the snapshot.
 */
export function nextWeekAsOf(asOf: string, snapshotDate: string): string | null {
  if (asOf >= snapshotDate) return null;
  const { sunday } = weekOf(asOf);
  return minDate(sunday >= snapshotDate ? snapshotDate : addDays(sunday, 7), snapshotDate);
}
