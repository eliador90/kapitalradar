// X1 claim check (CEO review): are capital increases that appear in the gazette before any
// announcement verifiable as new financings? Candidates: HR02 increases with preferred shares,
// Apr–Jul 2026 (time for an announcement to appear), never a sealed or inspected company.
// Evaluation rule (fixed before research): in seeded order, the first 10 candidates that are
// (a) startups and (b) gazette-first (no public announcement dated before the gazette entry)
// are evaluated; others are logged as skipped with the reason. Each evaluated one gets
// verified (independent evidence of new financing), refuted (evidence it is not one) or
// unverifiable. ≥ 4/10 verified keeps the "unannounced rounds" claim.
//
//   npm run x1 -- draw     → .data/x1/candidates.json (research context) + eval/x1/candidates.json
//   npm run x1 -- tally    .data/x1/results-*.json (research) → eval/x1/evidence.json + ledger
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { addToLedger, sealedUids } from "../eval/lib/ledger";
import { assertNoListedNames, loadNameList } from "../eval/lib/scrub";
import { seededShuffle } from "../eval/lib/seeded";
import { readCapital } from "../lib/pipeline/capital";
import { cachePublicationXml, fetchPublicationXml, publicationUrl, searchAll, type PublicationMeta } from "../lib/pipeline/shab";

const SEED = 3508160021; // drawn 2026-10-05, before the draw ran
const WINDOW = { start: "2026-04-01", end: "2026-07-31" } as const;
const KEYWORDS = ["Vorzugsaktien", "privilégiées"] as const;
const DRAW = 20;
const EVALUATE = 10;
const CLAIM_THRESHOLD = 4;
// Short class tokens only: a greedier pattern runs into the "registered persons" clause.
const PREFERRED = /Vorzugsaktien(?: Serie)?(?: [A-Z0-9][\w-]{0,7})?|privilégiées|privilegiate|Série [A-Z][\w-]{0,7}|Serie [A-Z][\w-]{0,7}/g;

const COMMITTED = "eval/x1/candidates.json";
const EVIDENCE = "eval/x1/evidence.json";

async function draw() {
  if (existsSync(COMMITTED)) throw new Error(`${COMMITTED} exists; refusing to redraw`);
  const excluded = sealedUids({ includeLedger: true });
  const metas = new Map<string, PublicationMeta>();
  for (const keyword of KEYWORDS) {
    for (const m of await searchAll({ keyword, subRubrics: ["HR02"], ...WINDOW })) metas.set(m.id, m);
  }
  const pool = [...metas.values()].sort((a, b) => a.id.localeCompare(b.id));
  console.log(`pool: ${pool.length} HR02 publications mentioning preferred shares`);
  const picked = [];
  const seen = new Set<string>();
  let skippedExcluded = 0;
  for (const m of seededShuffle(pool, SEED)) {
    if (picked.length >= DRAW) break;
    const xml = await fetchPublicationXml(m.id, { cache: false });
    const c = readCapital(xml);
    if (!c.uid) continue;
    if (excluded.has(c.uid)) {
      skippedExcluded++; // discarded unseen
      continue;
    }
    if (!c.isAg || !c.isIncrease || seen.has(c.uid)) continue;
    seen.add(c.uid);
    cachePublicationXml(m.id, xml);
    picked.push({
      order: picked.length + 1,
      uid: c.uid,
      company: c.company,
      seat: c.seat,
      publicationId: m.id,
      publicationNumber: m.publicationNumber,
      publishedAt: m.publishedAt,
      capitalBefore: c.before,
      capitalAfter: c.after,
      preferredClasses: [...new Set(c.text.match(PREFERRED) ?? [])].slice(0, 6),
      setOff: c.setOff,
      shabUrl: publicationUrl(m.id),
      purpose: c.purpose.slice(0, 300),
    });
  }
  mkdirSync("eval/x1", { recursive: true });
  mkdirSync(".data/x1", { recursive: true });
  writeFileSync(".data/x1/candidates.json", JSON.stringify(picked, null, 2));
  writeFileSync(
    COMMITTED,
    JSON.stringify({ seed: SEED, window: WINDOW, keywords: KEYWORDS, candidates: picked.map(({ purpose: _p, ...rest }) => rest) }, null, 2) + "\n",
  );
  console.log(`drew ${picked.length} candidates (${skippedExcluded} sealed/inspected discarded unseen)`);
}

const research = z.object({
  order: z.number().int(),
  company: z.string(),
  startup: z.enum(["yes", "no", "unclear"]),
  startup_reason: z.string(),
  announced_before_gazette: z.boolean().nullable(),
  verdict: z.enum(["verified", "refuted", "unverifiable"]),
  evidence: z.string(),
  sources: z.array(z.string()),
});

function tally() {
  const { candidates } = JSON.parse(readFileSync(COMMITTED, "utf8")) as { candidates: { order: number; uid: string; publicationNumber: string; publishedAt: string }[] };
  const results = readdirSync(".data/x1")
    .filter((f) => f.startsWith("results-") && f.endsWith(".json"))
    .flatMap((f) => z.array(research).parse(JSON.parse(readFileSync(`.data/x1/${f}`, "utf8"))))
    .sort((a, b) => a.order - b.order);
  if (results.length !== candidates.length) throw new Error(`research covers ${results.length} of ${candidates.length} candidates`);
  let evaluated = 0;
  const rows = results.map((r) => {
    const c = candidates.find((x) => x.order === r.order);
    if (!c) throw new Error(`no candidate ${r.order}`);
    let status: string;
    if (evaluated >= EVALUATE) status = "not_needed";
    else if (r.startup !== "yes") status = `skipped: not a startup (${r.startup})`;
    else if (r.announced_before_gazette === true) status = "skipped: announced before the gazette";
    else {
      status = "evaluated";
      evaluated++;
    }
    return { order: r.order, uid: c.uid, company: r.company, gazettePublished: c.publishedAt, publicationNumber: c.publicationNumber, startup: r.startup, startupReason: r.startup_reason, announcedBeforeGazette: r.announced_before_gazette, status, verdict: r.verdict, evidence: r.evidence, sources: r.sources };
  });
  const ev = rows.filter((r) => r.status === "evaluated");
  const count = (v: string) => ev.filter((r) => r.verdict === v).length;
  const summary = { evaluated: ev.length, verified: count("verified"), refuted: count("refuted"), unverifiable: count("unverifiable"), threshold: CLAIM_THRESHOLD, claimKept: count("verified") >= CLAIM_THRESHOLD };
  const out = JSON.stringify({ researchedBy: "Claude subagents (web search), reviewed by Remo 2026-10-06", rule: `first ${EVALUATE} in seeded order that are startups and gazette-first; >= ${CLAIM_THRESHOLD} verified keeps the claim`, summary, rows }, null, 2) + "\n";
  assertNoListedNames(EVIDENCE, out, loadNameList());
  writeFileSync(EVIDENCE, out);
  const added = addToLedger(rows.map((r) => ({ uid: r.uid, company: r.company })), "x1");
  console.log(summary, `(${added} companies added to the inspected ledger)`);
}

const [cmd] = process.argv.slice(2);
if (cmd === "draw") await draw();
else if (cmd === "tally") tally();
else {
  console.error("usage: x1 <draw|tally>");
  process.exit(1);
}
