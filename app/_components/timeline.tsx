"use client";

// The "Published by" control as a seismograph of the gazette (stage 1 of the radar redesign).
// Bars are drawn only up to the date the server rendered: the browser never receives later
// days, so dragging back in time can't reveal the future. Dragging forward shows the hatch
// until the page for the new date arrives.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { DayCount } from "../../lib/data/readers";

const DAY = 864e5;
const toT = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso: string) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

interface Props {
  series: DayCount[];
  asOf: string;
  backfillStart: string;
  snapshotDate: string;
  /** Feed filter to keep in the URL. */
  filter: string | null;
}

const H = 150;
const PAD = { l: 34, r: 8, t: 12, b: 22 };

export function Timeline({ series, asOf, backfillStart, snapshotDate, filter }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cursor, setCursor] = useState(asOf);
  useEffect(() => setCursor(asOf), [asOf]);
  const svgRef = useRef<SVGSVGElement>(null);
  // Drawn at the element's real width, so labels never stretch on narrow screens.
  const [W, setW] = useState(1200);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const drag = useRef(false);
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const n = Math.round((toT(snapshotDate) - toT(backfillStart)) / DAY) + 1;
  const bw = (W - PAD.l - PAD.r) / n;
  const idx = (iso: string) => Math.round((toT(iso) - toT(backfillStart)) / DAY);
  const max = useMemo(() => Math.max(4, ...series.map((s) => s.likely + s.undecided + s.increased)), [series]);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const clamp = (iso: string) => (iso < backfillStart ? backfillStart : iso > snapshotDate ? snapshotDate : iso);

  const go = (iso: string) => {
    const q = new URLSearchParams();
    if (iso !== snapshotDate) q.set("asof", iso);
    if (filter) q.set("s", filter);
    const s = q.toString();
    startTransition(() => router.push(s ? `/?${s}` : "/", { scroll: false }));
  };
  const dayAt = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    return clamp(toISO(toT(backfillStart) + Math.floor((x - PAD.l) / bw) * DAY));
  };

  const ci = idx(cursor);
  const shown = idx(asOf); // bars exist up to the rendered date only
  const cx = PAD.l + (ci + 0.5) * bw;
  const monday = (iso: string) => { const t = toT(iso); const wd = (new Date(t).getUTCDay() + 6) % 7; return toISO(t - wd * DAY); };
  const weekFrom = Math.max(0, idx(monday(cursor)));
  const months: { x: number; label: string }[] = [];
  for (let t = toT(backfillStart); t <= toT(snapshotDate); t += DAY) {
    const iso = toISO(t);
    if (iso.endsWith("-01")) months.push({ x: PAD.l + idx(iso) * bw, label: `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}` });
  }

  return (
    <div className="timeline">
      <div className="tl-head">
        <div>
          <span className="label">Published by</span> <span className="cursor-date">{fmt(cursor)}</span>
          {pending && <span className="tl-loading"> · loading</span>}
        </div>
        <span className="tl-hint">Drag the red line through time · ← → a day · Shift+← → a week. Later days aren&rsquo;t drawn: they haven&rsquo;t been published yet.</span>
      </div>
      <svg
        ref={svgRef}
        className="tl-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="slider"
        tabIndex={0}
        aria-label="Published by date"
        aria-valuemin={toT(backfillStart)}
        aria-valuemax={toT(snapshotDate)}
        aria-valuenow={toT(cursor)}
        aria-valuetext={fmt(cursor)}
        onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); setCursor(dayAt(e.clientX)); }}
        onPointerMove={(e) => { if (drag.current) setCursor(dayAt(e.clientX)); }}
        onPointerUp={(e) => { if (!drag.current) return; drag.current = false; const d = dayAt(e.clientX); setCursor(d); if (d !== asOf) go(d); }}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
          if (!step) return;
          e.preventDefault();
          const d = clamp(toISO(toT(cursor) + step * (e.shiftKey ? 7 : 1) * DAY));
          setCursor(d);
          if (keyTimer.current) clearTimeout(keyTimer.current);
          keyTimer.current = setTimeout(() => go(d), 450);
        }}
      >
        <defs>
          <pattern id="tl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="tl-hatch-line" />
          </pattern>
        </defs>
        {[0.5, 1].map((g) => (
          <g key={g}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(max * g)} y2={y(max * g)} className="tl-grid" />
            <text x={PAD.l - 6} y={y(max * g) + 4} className="tl-axis" textAnchor="end">{Math.round(max * g)}</text>
          </g>
        ))}
        <rect x={PAD.l + weekFrom * bw} y={PAD.t} width={Math.max(bw, (ci - weekFrom + 1) * bw)} height={H - PAD.t - PAD.b} className="tl-week" />
        {series.map((s) => {
          const i = idx(s.d);
          if (i > Math.min(shown, ci)) return null;
          const x = PAD.l + i * bw + 0.15 * bw;
          const w = Math.max(0.6, 0.7 * bw);
          const parts: [number, string][] = [[s.increased, "tl-increased"], [s.undecided, "tl-undecided"], [s.likely, "tl-likely"]];
          let acc = 0;
          return (
            <g key={s.d}>
              {parts.map(([v, cls]) => {
                if (!v) return null;
                const el = <rect key={cls} x={x} y={y(acc + v)} width={w} height={y(acc) - y(acc + v)} className={cls} />;
                acc += v;
                return el;
              })}
            </g>
          );
        })}
        <rect x={cx} y={PAD.t} width={Math.max(0, W - PAD.r - cx)} height={H - PAD.t - PAD.b} fill="url(#tl-hatch)" />
        {ci < n - 1 && (
          <text x={cx > W - 220 ? cx - 8 : cx + 8} y={PAD.t + 14} className="tl-axis" textAnchor={cx > W - 220 ? "end" : "start"}>
            not yet published
          </text>
        )}
        <line x1={cx} x2={cx} y1={PAD.t - 8} y2={H - PAD.b + 2} className="tl-cursor" />
        <polygon points={`${cx - 6},${PAD.t - 12} ${cx + 6},${PAD.t - 12} ${cx},${PAD.t - 4}`} className="tl-cursor-head" />
        {months.map((m, i) => i % Math.ceil(44 / (30 * bw)) === 0 && (
          <text key={m.label} x={m.x} y={H - 6} className="tl-axis">{m.label}</text>
        ))}
      </svg>
    </div>
  );
}
