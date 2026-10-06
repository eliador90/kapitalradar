// Unseal the recall cohort (plan: once, after rules and τ are frozen). Matches each cohort round
// to the capital increases its company published within the match window; adjudication is
// Remo's (eng V6). Refuses to run before the freeze.
//
//   npm run unseal -- match     → eval/cohort-matches.json + .data/cohort/review.md
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { matchRound } from "../eval/lib/match";
import { cohortFile } from "../eval/lib/schemas";
import { loadClassificationConfig } from "../lib/pipeline/config";
import { companyLevelText } from "../lib/pipeline/clauses";
import { fetchPublicationXml } from "../lib/pipeline/shab";
import { textAt } from "../lib/pipeline/xml";

const OUT = "eval/cohort-matches.json";

async function match() {
  const cfg = loadClassificationConfig();
  if (!cfg.frozenAt) throw new Error("rules and τ are not frozen: the cohort stays sealed");
  if (existsSync(OUT)) throw new Error(`${OUT} exists: the cohort is unsealed once`);
  const { cohort, matchWindowDays } = cohortFile.parse(JSON.parse(readFileSync("eval/cohort.json", "utf8")));
  const unsealedAt = new Date().toISOString();
  const rows = [];
  const review: string[] = ["# Cohort match review (company-level text only)", ""];
  for (const round of cohort) {
    const row = await matchRound(round, matchWindowDays);
    rows.push(row);
    review.push(`## ${round.rank} · ${round.company} · announced ${round.announced}`, `${round.title}`, "");
    for (const c of row.candidates) {
      const text = textAt(await fetchPublicationXml(c.id), ["content", "publicationText"]) ?? "";
      review.push(`- ${c.publishedAt} (${c.lagDays >= 0 ? "+" : ""}${c.lagDays} d) ${c.publicationNumber} nominal ${c.before} → ${c.after}${c.setOff ? " · set-off" : ""}`, `  ${companyLevelText(text).slice(0, 700)}`, "");
    }
    if (!row.candidates.length) review.push(`- no increase in window (${row.increasesTotal} increases in total, ${row.publications} publications)`, "");
    console.log(`${round.rank}: ${row.candidates.length} candidate(s)`);
  }
  writeFileSync(OUT, JSON.stringify({ unsealedAt, frozenAt: cfg.frozenAt, matchWindowDays, rows }, null, 2) + "\n");
  mkdirSync(".data/cohort", { recursive: true });
  writeFileSync(".data/cohort/review.md", review.join("\n"));
  const found = rows.filter((r) => r.candidates.length > 0).length;
  console.log(`unsealed at ${unsealedAt} (τ frozen ${cfg.frozenAt}); ${found}/${rows.length} rounds with ≥1 candidate`);
}

const [cmd] = process.argv.slice(2);
if (cmd === "match") await match();
else {
  console.error("usage: unseal <match>");
  process.exit(1);
}
