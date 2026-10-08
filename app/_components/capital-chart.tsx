"use client";

// Nominal capital over time, stacked by share class (radar redesign, stage 2). The series is
// built on the server from steps published by asOf; the right edge of the chart is asOf itself.
import { useEffect, useRef, useState } from "react";
import { ALL_SHARES, compactAmount, type CapitalSeries } from "../../lib/domain/capital-series";

const DAY = 864e5;
const toT = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso: string) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

const PLAIN = ["#2c4a5a", "#3d6578", "#527f93"];
const PREFERRED = ["#4fe0c3", "#2fa892", "#9cf0de", "#1f7a6b"];
// Keys we name ourselves (English); class labels from the gazette keep the entry's language.
const GENERATED = new Set([ALL_SHARES, "shares", "preferred shares"]);
const H = 220;
const PAD = { l: 52, r: 14, t: 16, b: 24 };

interface Props {
  series: CapitalSeries;
  asOf: string;
  /** Round announcements published by asOf. */
  announcements: string[];
  lang?: string;
}

export function CapitalChart({ series, asOf, announcements, lang }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { steps, keys, preferredKeys, currency, start } = series;
  const end = toT(asOf);
  // Announcements often precede the gazette entry: the time axis starts early enough to show them.
  const first = Math.min(toT(steps[0]!.date), ...announcements.map(toT));
  const span = Math.max(60 * DAY, end - first);
  const t0 = first - span * 0.12;
  const x = (iso: string) => PAD.l + ((toT(iso) - t0) / (end - t0)) * (W - PAD.l - PAD.r);
  const max = Math.max(start ?? 0, ...steps.map((s) => s.total)) * 1.12 || 1;
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const colour = new Map<string, string>();
  keys.filter((k) => !preferredKeys.includes(k)).forEach((k, i) => colour.set(k, PLAIN[i % PLAIN.length]!));
  preferredKeys.forEach((k, i) => colour.set(k, PREFERRED[i % PREFERRED.length]!));

  const xs = steps.map((s) => x(s.date));
  const right = W - PAD.r;
  let line = start !== null ? `M${PAD.l},${y(start)} H${xs[0]}` : `M${xs[0]},${y(steps[0]!.total)}`;
  steps.forEach((s, i) => (line += ` V${y(s.total)} H${xs[i + 1] ?? right}`));
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => (max / 1.12) * f);
  const years: string[] = [];
  const yearStep = Math.max(1, Math.ceil(((end - t0) / (365 * DAY)) / ((W - PAD.l - PAD.r) / 48)));
  for (let yr = new Date(t0).getUTCFullYear() + 1; Date.UTC(yr, 0, 1) <= end; yr++) if (yr % yearStep === 0) years.push(`${yr}-01-01`);
  const last = steps.at(-1)!;
  const label = `Nominal capital ${start !== null ? `from ${currency} ${compactAmount(start)} ` : ""}to ${currency} ${compactAmount(last.total)} over ${steps.length} published step${steps.length === 1 ? "" : "s"}, up to ${fmt(asOf)}.`;

  return (
    <figure className="capital-chart">
      <figcaption className="chart-head">
        <span className="label">Nominal capital · {currency}</span>
        <span className="chart-now">
          {currency} {compactAmount(last.total)}
        </span>
      </figcaption>
      <svg ref={ref} className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={right} y1={y(v)} y2={y(v)} className="tl-grid" />
            <text x={PAD.l - 6} y={y(v) + 4} className="tl-axis" textAnchor="end">
              {compactAmount(v)}
            </text>
          </g>
        ))}
        {start !== null && <rect x={PAD.l} y={y(start)} width={Math.max(0, xs[0]! - PAD.l)} height={y(0) - y(start)} fill={PLAIN[0]} opacity={0.45} />}
        {steps.map((s, i) => {
          let acc = 0;
          const x1 = xs[i]!;
          const w = Math.max(0, (xs[i + 1] ?? right) - x1);
          return (
            <g key={s.date + i}>
              {keys.map((k) => {
                const v = s.parts.find((p) => p.key === k)?.value ?? 0;
                if (!v) return null;
                const r = <rect key={k} x={x1} y={y(acc + v)} width={w} height={y(acc) - y(acc + v)} fill={colour.get(k)} opacity={0.85} />;
                acc += v;
                return r;
              })}
            </g>
          );
        })}
        <path d={line} className="chart-line" />
        {steps.map((s, i) =>
          s.tone ? (
            <circle key={`m${i}`} cx={xs[i]} cy={y(s.total)} r={4.5} className={`chart-mark mark-${s.tone}`}>
              <title>{`${fmt(s.date)} · ${currency} ${compactAmount(s.total)}`}</title>
            </circle>
          ) : null,
        )}
        {announcements.map((d, i) => (
          <path key={`a${i}`} d={`M${x(d)},${H - PAD.b - 7} l5,5 l-5,5 l-5,-5 z`} className="chart-announce">
            <title>{`Round announced ${fmt(d)}`}</title>
          </path>
        ))}
        <line x1={right} x2={right} y1={PAD.t - 6} y2={H - PAD.b} className="tl-cursor" />
        {years.map((d) => (
          <text key={d} x={x(d)} y={H - 6} className="tl-axis" textAnchor={x(d) > right - 30 ? "end" : "start"}>
            {d.slice(0, 4)}
          </text>
        ))}
      </svg>
      <ul className="chart-legend">
        {keys.map((k) => (
          <li key={k} lang={GENERATED.has(k) ? undefined : lang}>
            <i className="sw" style={{ background: colour.get(k) }} aria-hidden="true" />
            {k}
          </li>
        ))}
        {announcements.length > 0 && (
          <li>
            <i className="sw sw-confirmed sw-diamond" aria-hidden="true" />
            round announced
          </li>
        )}
        {series.omitted > 0 && <li className="muted">{series.omitted} earlier step{series.omitted === 1 ? "" : "s"} in another currency not drawn</li>}
      </ul>
    </figure>
  );
}
