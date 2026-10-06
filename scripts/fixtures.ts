// Builds the committed parser fixtures (T4) from cached publications of dev/inspected companies.
// Fixtures keep the structured XML and only company-level clauses of the text: person clauses
// and unclassified clauses are dropped, inline names masked, address and auditor elements
// removed, and every fixture must pass the person-data gate (eng A6, design line 213).
//
//   npm run fixtures            → eval/fixtures/shab/<slug>.xml + .data/fixtures-review.md
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cohortUids } from "../eval/lib/ledger";
import { assertNoListedNames, loadNameList } from "../eval/lib/scrub";
import { readCapital } from "../lib/pipeline/capital";
import { companyLevelText, personDataHits } from "../lib/pipeline/clauses";
import { textAt } from "../lib/pipeline/xml";

/** slug → SHAB publication number. Each covers a parser case. */
export const FIXTURES: Record<string, string> = {
  "de-in-kind": "HR02-1006437830",
  "de-new-preferred-preseed": "HR02-1006443721",
  "de-set-off-within-band": "HR02-1006700648",
  "de-deleted-in-kind-is-cash": "HR02-1006399440",
  "de-conversion-gmbh-ag": "HR02-1006630361",
  "de-conversion-name-change": "HR02-1005735305",
  "de-new-seed-class-mixed": "HR02-1006479540",
  "de-restructuring-pair": "HR02-1006636729",
  "de-correction": "HR02-1006711890",
  "fr-new-format-cash": "HR02-1006763030",
  "fr-usd": "HR02-1006516345",
  "fr-set-off": "HR02-1006602773",
  "fr-conditional-capital": "HR02-1006705679",
  "fr-conversion-sarl-sa": "HR02-1006551876",
  "fr-mixed-partial-set-off": "HR02-1006728040",
  "fr-old-format-mixed": "HR02-1006543104",
  "fr-split-new-preferred": "HR02-1006716136",
  "fr-reduction": "HR02-1006768960",
  "fr-correction": "HR02-1005205992",
  "fr-formation": "HR01-1004804379",
  "it-increase": "HR02-1006603981",
};

const OUT = "eval/fixtures/shab";

function byNumber(): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of readdirSync(".data/shab")) {
    const xml = readFileSync(`.data/shab/${f}`, "utf8");
    const n = textAt(xml, ["meta", "publicationNumber"]);
    if (n) map.set(n, xml);
  }
  return map;
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Company-level text only; address and auditor elements removed (an auditor can be a natural
 * person). Business addresses inside the header text are company-level and stay.
 */
export function scrubXml(xml: string): string {
  const text = textAt(xml, ["content", "publicationText"]) ?? "";
  const kept = escapeXml(companyLevelText(text));
  // Function replacements: "$&" or "$'" in the text must not be expanded.
  return xml
    .replace(/<publicationText>[\s\S]*?<\/publicationText>/, () => `<publicationText>${kept}</publicationText>`)
    .replace(/<address>[\s\S]*?<\/address>/g, () => "<address/>")
    .replace(/<revision>[\s\S]*?<\/revision>/g, () => "<revision/>")
    .replace(/<registrationOffice>[\s\S]*?<\/registrationOffice>/, () => "<registrationOffice/>");
}

function main() {
  const cache = byNumber();
  const cohort = cohortUids();
  const names = loadNameList();
  mkdirSync(OUT, { recursive: true });
  const review: string[] = ["# Fixture review: every kept clause, check for person names", ""];
  for (const [slug, number] of Object.entries(FIXTURES)) {
    const xml = cache.get(number);
    if (!xml) throw new Error(`${slug}: ${number} not in .data/shab`);
    const uid = readCapital(xml).uid;
    if (uid && cohort.has(uid)) throw new Error(`${slug}: cohort company`);
    const out = scrubXml(xml);
    assertNoListedNames(slug, out, names);
    // Design line 213: fail on person-data patterns not covered by a scrub token.
    const hits = personDataHits(out);
    if (hits.length) throw new Error(`${slug}: person-data gate failed (${hits.join(", ")}); extend the masking, never commit`);
    writeFileSync(`${OUT}/${slug}.xml`, out);
    review.push(`## ${slug} (${number})`, "", textAt(out, ["content", "publicationText"]) ?? "", "");
  }
  writeFileSync(".data/fixtures-review.md", review.join("\n"));
  console.log(`wrote ${Object.keys(FIXTURES).length} fixtures → ${OUT}; review in .data/fixtures-review.md`);
}

if (process.argv[1]?.endsWith("fixtures.ts")) main();
