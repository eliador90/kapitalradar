// Event matching (plan "Matching"): the capital increases a company published within the match
// window around an announced round. One definition for the spike and the recall cohort.
import { daysBetween } from "../../lib/domain/dates";
import { readCapital } from "../../lib/pipeline/capital";
import { cachePublicationXml, fetchPublicationXml, searchByUid } from "../../lib/pipeline/shab";
import type { CohortRound } from "./schemas";

export interface Increase {
  id: string;
  publicationNumber: string;
  publishedAt: string;
  lagDays: number; // publishedAt − announced; negative = gazette first
  before: number;
  after: number;
  setOff: boolean;
  capitalBand: boolean;
}

export interface MatchRow {
  rank: number;
  uid: string;
  company: string;
  announced: string;
  publications: number;
  earliestPublication: string | null;
  formationFound: boolean;
  increasesTotal: number;
  candidates: Increase[];
  /** Filled by hand (eng V6): accepted publication id, or null with a reason. */
  adjudication: { accepted: string | null; note: string };
}

/**
 * @param skip UIDs whose entries must not be cached or used (sealed companies, for the spike)
 */
export async function matchRound(round: CohortRound, window: { before: number; after: number }, skip: Set<string> = new Set()): Promise<MatchRow> {
  // The UID keyword search also returns entries that merely cite the UID (mergers, parents):
  // keep only the company's own publications.
  const own = [];
  for (const m of await searchByUid(round.uid)) {
    if (!m.subRubric.startsWith("HR")) continue;
    const xml = await fetchPublicationXml(m.id, { cache: false });
    const c = readCapital(xml);
    if (c.uid && skip.has(c.uid)) continue;
    if (c.uid !== round.uid) continue;
    cachePublicationXml(m.id, xml);
    own.push({ m, c });
  }
  const increases: Increase[] = own
    .filter(({ m, c }) => m.subRubric === "HR02" && c.isIncrease)
    .map(({ m, c }) => ({
      id: m.id,
      publicationNumber: m.publicationNumber,
      publishedAt: m.publishedAt,
      lagDays: daysBetween(round.announced, m.publishedAt),
      before: c.before,
      after: c.after,
      setOff: c.setOff,
      capitalBand: c.capitalBand,
    }));
  return {
    rank: round.rank,
    uid: round.uid,
    company: round.company,
    announced: round.announced,
    publications: own.length,
    earliestPublication: own.map(({ m }) => m.publishedAt).sort()[0] ?? null,
    formationFound: own.some(({ m }) => m.subRubric === "HR01"),
    increasesTotal: increases.length,
    candidates: increases.filter((i) => i.lagDays >= -window.before && i.lagDays <= window.after),
    adjudication: { accepted: null, note: "" },
  };
}
