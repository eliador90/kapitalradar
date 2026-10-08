import { CANTON_CODES, SWISS_MAP } from "../../lib/domain/cantons";
import { formatDate } from "../../lib/domain/format";
import { SweepToggle } from "./sweep-toggle";

// The scope (radar redesign, stage 3): likely financings per canton over the map window, on the
// real canton shapes. Server-rendered; the sweep is CSS, and each blip lights up as the beam
// passes its bearing. Clicking a canton filters the feed below (plain links, no JS needed).
const CENTER = [500, 320] as const;
const PERIOD_S = 4;
const RINGS = [90, 180, 270, 360, 450];

/** Seconds into the sweep when the beam (starting at 12 o'clock, clockwise) crosses (x, y). */
function hitDelay(x: number, y: number) {
  const a = Math.atan2(y - CENTER[1], x - CENTER[0]) + Math.PI / 2;
  const turn = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return (turn / (2 * Math.PI)) * PERIOD_S - PERIOD_S;
}

interface Props {
  counts: Record<string, number>;
  from: string;
  asOf: string;
  selected: string | null;
  /** Href that selects a canton (null clears the filter). */
  hrefFor: (canton: string | null) => string;
}

export function RadarMap({ counts, from, asOf, selected, hrefFor }: Props) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(counts));
  return (
    <section className="radar" id="radar" aria-labelledby="radar-title">
      <div className="radar-head">
        <h2 className="label" id="radar-title">
          Scope · likely financings by canton
        </h2>
        <SweepToggle />
      </div>
      <svg className="radar-svg" viewBox={SWISS_MAP.viewBox} role="group" aria-label={`Map of Swiss cantons: ${total} likely financings published ${formatDate(from)} to ${formatDate(asOf)}`}>
        <defs>
          <linearGradient id="sweep-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--sweep)" stopOpacity="0" />
            <stop offset="1" stopColor="var(--sweep)" stopOpacity="0.22" />
          </linearGradient>
        </defs>
        {RINGS.map((r) => (
          <circle key={r} cx={CENTER[0]} cy={CENTER[1]} r={r} className="radar-ring" />
        ))}
        <path d={`M0,${CENTER[1]} H1000 M${CENTER[0]},0 V640`} className="radar-ring" />
        <path d={SWISS_MAP.outline} className="map-land" />
        {CANTON_CODES.map((c) => {
          const n = counts[c] ?? 0;
          const shape = SWISS_MAP.cantons[c]!;
          return (
            <a key={c} href={hrefFor(selected === c ? null : c)} aria-label={`${c}: ${n} likely financing${n === 1 ? "" : "s"}${selected === c ? ", selected; show all cantons" : ""}`}>
              <path
                d={shape.d}
                className={`canton${selected === c ? " is-selected" : ""}${selected && selected !== c ? " is-dimmed" : ""}`}
                style={{ fillOpacity: n ? 0.08 + 0.32 * (n / max) : undefined }}
                data-hot={n > 0 || undefined}
              />
            </a>
          );
        })}
        <path d={SWISS_MAP.inner} className="map-inner" />
        <path d={SWISS_MAP.outline} className="map-outline" />
        <g className="sweep" aria-hidden="true">
          <path d={`M${CENTER[0]},${CENTER[1]} L${CENTER[0]},${CENTER[1] - 520} A520,520 0 0 0 ${CENTER[0] - 520 * Math.sin(0.6)},${CENTER[1] - 520 * Math.cos(0.6)} Z`} fill="url(#sweep-fade)" />
          <line x1={CENTER[0]} y1={CENTER[1]} x2={CENTER[0]} y2={CENTER[1] - 520} className="sweep-beam" />
        </g>
        <g aria-hidden="true">
          {CANTON_CODES.flatMap((c) => {
            const { cx, cy } = SWISS_MAP.cantons[c]!;
            return Array.from({ length: counts[c] ?? 0 }, (_, i) => {
              const ang = i * 2.399;
              const d = 3 + 5 * Math.sqrt(i);
              const x = cx + Math.cos(ang) * d;
              const y = cy + Math.sin(ang) * d;
              return <circle key={`${c}${i}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r={3.6} className="blip" style={{ animationDelay: `${hitDelay(x, y).toFixed(2)}s` }} />;
            });
          })}
          {CANTON_CODES.map((c) => {
            const { lx, ly } = SWISS_MAP.cantons[c]!;
            const n = counts[c] ?? 0;
            return (
              <text key={c} x={lx} y={ly - (n ? 14 : 0)} textAnchor="middle" className={`canton-label${n ? " is-hot" : ""}`}>
                {c}
              </text>
            );
          })}
        </g>
      </svg>
      <p className="radar-foot">
        <span>
          {total} likely financing{total === 1 ? "" : "s"} · {formatDate(from)} – {formatDate(asOf)}
        </span>
        {selected ? (
          <a className="canton-chip" href={hrefFor(null)}>
            {selected} ✕ show all cantons
          </a>
        ) : (
          <span>Click a canton to filter the feed</span>
        )}
        <span className="map-credit">Map: Natural Earth</span>
      </p>
    </section>
  );
}
