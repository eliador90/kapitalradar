import { formatAmount } from "../../lib/domain/format";

// What the three statuses mean, in plain words (radar redesign: Remo found the labels unclear).
// Thresholds come from the release's frozen config, so the text always matches the classifier.
export function StatusLegend({ tau, tauLow }: { tau: number; tauLow: number }) {
  const t = (v: number) => formatAmount(v.toFixed(2));
  return (
    <dl className="status-legend">
      <div>
        <dt>
          <i className="sw sw-likely" aria-hidden="true" />
          Likely financing
        </dt>
        <dd>Looks like new money from outside investors: Claude, reading the entry and the rule signals, scores it {t(tau)} or higher.</dd>
      </div>
      <div>
        <dt>
          <i className="sw sw-undecided" aria-hidden="true" />
          Undecided
        </dt>
        <dd>
          Some financing signals, not enough to call it: a score from {t(tauLow)} to below {t(tau)}, or no usable score.
        </dd>
      </div>
      <div>
        <dt>
          <i className="sw sw-increased" aria-hidden="true" />
          Capital increased
        </dt>
        <dd>No sign of a financing round: a score below {t(tauLow)}. Typical causes are converted loans, assets contributed in kind, reserves turned into capital or a conversion to an AG.</dd>
      </div>
      <div>
        <dt>
          <i className="sw sw-confirmed" aria-hidden="true" />
          Confirmed round
        </dt>
        <dd>A financing announcement on startupticker.ch names the company and matches this increase.</dd>
      </div>
    </dl>
  );
}
