import type { Status } from "../../lib/domain/status";

/** Colour family per status (amber, violet, slate, phosphor); the label always carries the meaning. */
export const statusTone = (s: Status) =>
  s.state === "confirmed" || s.state === "confirmed_missed"
    ? "confirmed"
    : s.state === "likely_financing" || (s.state === "possible_confirmation" && s.pips === "●●○")
      ? "likely"
      : s.state === "abstain" || (s.state === "possible_confirmation" && s.pips === "◐○○")
        ? "undecided"
        : "increased";

// Pips are decoration (aria-hidden); the label carries the meaning (design DS1).
export function StatusLabel({ status }: { status: Status }) {
  return (
    <span className={`status tone-${statusTone(status)}`}>
      {status.pips && (
        <span className="pips" aria-hidden="true">
          {status.pips}
        </span>
      )}
      {status.label}
    </span>
  );
}

/** Claude's score against the likely-financing threshold; absent when nothing was classified. */
export function ScoreMeter({ score, tau, tone }: { score: number | null; tau: number; tone: string }) {
  if (score === null) return null;
  return (
    <span className="meter" title={`Classifier score ${score.toFixed(2)} · likely-financing threshold ${tau.toFixed(2)} · not a calibrated probability`}>
      <span className="meter-track" aria-hidden="true">
        <span className={`meter-fill tone-${tone}`} style={{ width: `${Math.round(score * 100)}%` }} />
        <span className="meter-tau" style={{ left: `${Math.round(tau * 100)}%` }} />
      </span>
      <span className="meter-value">score {score.toFixed(2)}</span>
    </span>
  );
}
