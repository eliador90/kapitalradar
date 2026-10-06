import type { Metadata } from "next";
import { missesSummary } from "../../lib/domain/eval-result";
import { formatDate } from "../../lib/domain/format";
import { BackLink } from "../_components/back-link";
import { getRelease } from "../_lib/release";

export const metadata: Metadata = { title: "Misses and rejections · Kapitalradar" };

// Recall-cohort rounds the classifier missed, plus sampled rejections (plan "Misses & rejections").
export default async function MissesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const release = await getRelease();
  const e = release.evaluation;
  return (
    <main id="record" className="reading">
      <BackLink release={release} sp={sp} />
      <h1 className="headline">Misses and rejections</h1>
      {!e ? (
        <p>No evaluation is attached to this release.</p>
      ) : (
        <>
          <p className="eval-line">Release evaluation · {formatDate(e.evaluatedOn)} · does not rewind</p>
          <h2>Announced rounds the classifier missed</h2>
          <p>{missesSummary(e)}</p>
          {e.misses.length > 0 && (
            <table className="metrics">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Announced</th>
                  <th scope="col">Why it was missed</th>
                </tr>
              </thead>
              <tbody>
                {e.misses.map((m, i) => (
                  <tr key={i}>
                    <td>{m.company}</td>
                    <td className="num">{formatDate(m.announced)}</td>
                    <td>{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2>A random sample of rejected capital increases</h2>
          <table className="metrics">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">SHAB published</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {e.rejections.map((r, i) => (
                <tr key={i}>
                  <td>{r.company}</td>
                  <td className="num">{formatDate(r.publishedAt)}</td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
