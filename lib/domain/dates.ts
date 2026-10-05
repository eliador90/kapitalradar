// Calendar dates as ISO strings ("2026-09-29"). SHAB publication days are Swiss calendar
// days with no time component, so date math stays in UTC and never touches local time.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === s;
}

const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * DAY);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY);
/** 0 = Monday … 6 = Sunday. */
export const isoWeekday = (iso: string) => (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
export const minDate = (a: string, b: string) => (a <= b ? a : b);
export const maxDate = (a: string, b: string) => (a >= b ? a : b);

const zurichFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Europe/Zurich calendar day of an instant (DST-aware). */
export const zurichDate = (instant: Date) => zurichFmt.format(instant);
