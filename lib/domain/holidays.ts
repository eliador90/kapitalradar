// Days without a SHAB issue (federal holidays plus Berchtoldstag and Boxing Day). Used by the
// release gate "a window weekday with a published gazette returned zero HR02 results".
import { addDays, isoWeekday } from "./dates";

/** Easter Sunday (Gregorian, anonymous algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function shabHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  return new Set([
    `${year}-01-01`, // New Year
    `${year}-01-02`, // Berchtoldstag
    addDays(easter, -2), // Good Friday
    addDays(easter, 1), // Easter Monday
    addDays(easter, 39), // Ascension
    addDays(easter, 50), // Whit Monday
    `${year}-08-01`, // National Day
    `${year}-12-25`,
    `${year}-12-26`,
  ]);
}

/** A weekday on which the gazette appears. */
export function isGazetteDay(iso: string): boolean {
  return isoWeekday(iso) < 5 && !shabHolidays(Number(iso.slice(0, 4))).has(iso);
}
