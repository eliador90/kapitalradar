import type { Metadata } from "next";
import Link from "next/link";
import { pct, type ReleaseEval } from "../../lib/domain/eval-result";
import { formatDate } from "../../lib/domain/format";
import { BackLink, backQuery } from "../_components/back-link";
import { getRelease, hrefWith } from "../_lib/release";

export const metadata: Metadata = { title: "Methodology · Kapitalradar" };

type System = ReleaseEval["systems"]["rulesOnly"];
const precision = (s: System) => (s.precision ? `${pct(s.precision.point)} (95% interval ${pct(s.precision.lo)}–${pct(s.precision.hi)}, n=${s.precision.n})` : "not measured");
const recall = (s: System) => `${s.recall.hits} of ${s.recall.n} announced rounds`;

// A current-eval surface outside rewind (design J2): not filtered by asOf.
export default async function MethodologyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const release = await getRelease();
  const e = release.evaluation;
  const c = release.config;
  return (
    <main id="record" className="reading">
      <BackLink release={release} sp={sp} />
      <h1 className="headline">Methodology</h1>
      <p className="eval-line">
        {e ? `Release evaluation · ${formatDate(e.evaluatedOn)} · does not rewind` : "Release evaluation · not available"} · data as of {formatDate(release.snapshotDate)} · release {release.id}
      </p>

      <h2>What this is</h2>
      <p>
        Every Swiss AG that raises its share capital must publish the change in the Swiss Official Gazette of Commerce (SHAB). Kapitalradar reads those
        entries from {formatDate(release.backfillStart)} to {formatDate(release.snapshotDate)}, rebuilds each company&rsquo;s capital history, and asks
        which increases look like a startup financing round. Every entry links to its SHAB publication.
      </p>

      <h2>How a capital increase is classified</h2>
      <p>
        A pre-filter keeps capital increases of AGs and drops restructurings and reductions. Rules score what the gazette states: the amount, the share
        nominal, the company&rsquo;s age and purpose, new preferred classes, how the increase was paid. Then {c.modelId} (prompt version {c.promptVersion})
        reads the same facts, with person names removed, and returns a score. An increase is shown as a likely financing at a score of {c.tau.toFixed(2)} or
        more; between {c.tauLow.toFixed(2)} and {c.tau.toFixed(2)} it is undecided. The score is not a calibrated probability. Thresholds were frozen on
        development data before the evaluation sets were opened.
      </p>

      <h2>Rules</h2>
      <table className="metrics">
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Kind</th>
            <th scope="col" className="num">
              Weight
            </th>
          </tr>
        </thead>
        <tbody>
          {c.rules.map((r) => (
            <tr key={r.id}>
              <td>{r.display}</td>
              <td>{r.kind.replace(/_/g, " ")}</td>
              <td className="num">{r.kind === "hard_negative" ? "excludes" : r.weight.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Rules-only counts an increase as a financing at a rules score of {c.rulesThreshold.toFixed(1)} or more.</p>

      <h2>Evaluation</h2>
      {e ? (
        <>
          <table className="metrics">
            <thead>
              <tr>
                <th scope="col">System</th>
                <th scope="col">Precision</th>
                <th scope="col">Recall</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Rules + Claude</th>
                <td>{precision(e.systems.rulesPlusClaude)}</td>
                <td>{recall(e.systems.rulesPlusClaude)}</td>
              </tr>
              <tr>
                <th scope="row">Rules only</th>
                <td>{precision(e.systems.rulesOnly)}</td>
                <td>{recall(e.systems.rulesOnly)}</td>
              </tr>
            </tbody>
          </table>
          {e.recallIncludingUndecided && (
            <p>
              Counting undecided increases as hits, rules + Claude finds {e.recallIncludingUndecided.hits} of {e.recallIncludingUndecided.n}.
            </p>
          )}
          <p>
            Recall is measured on {e.cohortSize} financing rounds announced in the press and sealed before any threshold was set. Precision is measured on a
            stratified sample of the system&rsquo;s positives, each checked by hand against outside evidence. {e.confirmationSource}
          </p>
          <p>
            <Link href={hrefWith("/misses", { asof: backQuery(release, sp).asof, s: backQuery(release, sp).s })}>
              Misses and rejections →
            </Link>
          </p>
        </>
      ) : (
        <p>No evaluation is attached to this release.</p>
      )}

      <h2>Limits</h2>
      <p>
        The SHAB states capital, shares and how they were paid. It does not state the amount raised, the price per share or the investors: those fields read
        &ldquo;not in the SHAB&rdquo;. GmbH capital changes are not covered. Company history before {formatDate(release.backfillStart)} comes from each
        company&rsquo;s own publications and is labeled when partial. Parser version {c.parserVersion}.
      </p>
    </main>
  );
}
