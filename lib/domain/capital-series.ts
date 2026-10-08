// The company page's capital step chart (radar redesign, stage 2): nominal capital after each
// published step, split by share class when the gazette lists the classes and they add up.
import type { ShareClass } from "./events";

export interface CapitalStepInput {
  publishedAt: string;
  currency: string | null;
  capitalBefore: string | null;
  capitalAfter: string | null;
  classesAfter: ShareClass[] | null;
  /** Status tone of the step (likely, undecided, increased, confirmed, or none when unassessed); null for non-increases. */
  tone: string | null;
}

export interface CapitalStep {
  date: string;
  total: number;
  /** Capital per class key, summing to `total`; one "all shares" entry when classes are unknown. */
  parts: { key: string; value: number }[];
  tone: string | null;
}

export interface CapitalSeries {
  currency: string;
  /** Capital before the first drawn step, or null when the record doesn't state it. */
  start: number | null;
  steps: CapitalStep[];
  /** Class keys bottom to top: preferred classes above plain shares, in order of appearance. */
  keys: string[];
  /** The keys that are preferred classes (drawn in the instrument colour). */
  preferredKeys: string[];
  /** Steps left out because they are in an earlier capital currency. */
  omitted: number;
}

export const ALL_SHARES = "all shares";
const CLASS_SUM_TOLERANCE = 0.005;

const classKey = (c: ShareClass) => c.label ?? (c.preferred ? "preferred shares" : "shares");

/** Class parts when the classes sum to the stated capital (±0.5 %), otherwise one total part. */
function partsOf(total: number, classes: ShareClass[] | null): { key: string; value: number }[] {
  if (classes && classes.length > 0) {
    const parts = new Map<string, number>();
    for (const c of classes) parts.set(classKey(c), (parts.get(classKey(c)) ?? 0) + c.count * Number(c.nominal));
    const sum = [...parts.values()].reduce((a, b) => a + b, 0);
    if (total > 0 && Math.abs(sum - total) / total <= CLASS_SUM_TOLERANCE) return [...parts].map(([key, value]) => ({ key, value }));
  }
  return [{ key: ALL_SHARES, value: total }];
}

/**
 * Steps in the latest capital currency, oldest first. Amounts in different currencies aren't
 * comparable, so steps before the last currency change are counted in `omitted`, not drawn.
 */
export function capitalSeries(input: CapitalStepInput[]): CapitalSeries | null {
  const usable = input.filter((s) => s.capitalAfter !== null && s.currency).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  if (usable.length === 0) return null;
  const currency = usable.at(-1)!.currency!;
  let from = usable.length - 1;
  while (from > 0 && usable[from - 1]!.currency === currency) from--;
  const run = usable.slice(from);
  const steps = run.map((s) => {
    const total = Number(s.capitalAfter);
    return { date: s.publishedAt, total, parts: partsOf(total, s.classesAfter), tone: s.tone };
  });
  const preferred = new Set(run.flatMap((s) => (s.classesAfter ?? []).filter((c) => c.preferred).map(classKey)));
  const seen = [...new Set(steps.flatMap((s) => s.parts.map((p) => p.key)))];
  const keys = [...seen.filter((k) => !preferred.has(k)), ...seen.filter((k) => preferred.has(k))];
  const first = run[0]!;
  const start = first.capitalBefore !== null ? Number(first.capitalBefore) : null;
  return { currency, start, steps, keys, preferredKeys: keys.filter((k) => preferred.has(k)), omitted: from };
}

/** "120k", "1.2M", "850": axis labels only; figures in the record stay exact. */
export function compactAmount(v: number): string {
  if (v >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${+(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(v));
}
