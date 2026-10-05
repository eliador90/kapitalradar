// The Assignment: 30 SHAB capital increases (15 DE, 15 FR), labeled on the two eval axes.
// Dev-only, text_only labels. Raw gazette text holds natural-person data, so the sheets live
// in the gitignored .data/assignment/; only ids, UIDs and labels are committed.
//
//   npm run assignment -- draw      seeded draw → .data/assignment/{entries.json, sheets}, eval/dev/assignment.json
//   npm run assignment -- collect   filled sheets → eval/dev/assignment-labels.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STARTUP_RELEVANCE, TRANSACTION_TYPES, parseSheet, type SheetLabel } from "../eval/lib/assignment-sheet";
import { addToLedger, sealedUids } from "../eval/lib/ledger";
import { assertNoListedNames, loadNameList } from "../eval/lib/scrub";
import { seededShuffle } from "../eval/lib/seeded";
import { readCapital } from "../lib/pipeline/capital";
import { cachePublicationXml, fetchPublicationXml, searchAll, type PublicationMeta } from "../lib/pipeline/shab";

const SEED = 2821117285; // drawn 2026-10-05, before the draw ran
const WINDOW = { start: "2025-08-01", end: "2026-10-05" } as const; // backfill window
const PER_LANGUAGE = 15;
const COLD = 10; // Remo labels the first 10 in draw order without seeing drafts
const QUERIES = [
  { lang: "de", keyword: "Aktienkapital" },
  { lang: "fr", keyword: "capital-actions" },
] as const;

const OUT = ".data/assignment";
const ENTRIES = join(OUT, "entries.json");
const COMMITTED = "eval/dev/assignment.json";
const LABELS = "eval/dev/assignment-labels.json";

interface Entry {
  n: number;
  id: string;
  publicationNumber: string;
  publishedAt: string;
  lang: string;
  uid: string;
  company: string;
  capitalBefore: string;
  capitalAfter: string;
  text: string;
  purpose: string;
}

async function draw() {
  if (existsSync(ENTRIES)) throw new Error(`${ENTRIES} exists; refusing to redraw`);
  const sealed = sealedUids();
  const chosenUids = new Set<string>();
  const byLang: Entry[][] = [];
  let discardedSealed = 0;
  for (const q of QUERIES) {
    const metas: PublicationMeta[] = (
      await searchAll({ keyword: q.keyword, subRubrics: ["HR02"], start: WINDOW.start, end: WINDOW.end })
    ).filter((m) => m.language === q.lang);
    metas.sort((a, b) => a.id.localeCompare(b.id));
    console.log(`${q.lang}: ${metas.length} publications match "${q.keyword}"`);
    const picked: Entry[] = [];
    for (const m of seededShuffle(metas, SEED)) {
      if (picked.length >= PER_LANGUAGE) break;
      const xml = await fetchPublicationXml(m.id, { cache: false });
      const c = readCapital(xml);
      if (!c.uid) continue;
      if (sealed.has(c.uid)) {
        discardedSealed++; // never written, never shown
        continue;
      }
      if (!c.isAg || !c.isIncrease || chosenUids.has(c.uid)) continue;
      chosenUids.add(c.uid);
      cachePublicationXml(m.id, xml);
      picked.push({
        n: 0,
        id: m.id,
        publicationNumber: m.publicationNumber,
        publishedAt: m.publishedAt,
        lang: q.lang,
        uid: c.uid,
        company: c.company,
        capitalBefore: String(c.before),
        capitalAfter: String(c.after),
        text: c.text,
        purpose: c.purpose,
      });
    }
    if (picked.length < PER_LANGUAGE) throw new Error(`${q.lang}: only ${picked.length} increases found`);
    byLang.push(picked);
  }
  // Interleave DE/FR so the cold 10 mix both languages.
  const entries = byLang[0]!.flatMap((e, i) => [e, byLang[1]![i]!]).map((e, i) => ({ ...e, n: i + 1 }));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(ENTRIES, JSON.stringify(entries, null, 2));
  writeFileSync(join(OUT, "remo-cold-10.md"), sheet(entries.slice(0, COLD), "Remo, cold: label without looking at any drafts"));
  writeFileSync(join(OUT, "claude-blind-10.md"), sheet(entries.slice(0, COLD), "Claude, blind: same 10, for the agreement check"));
  writeFileSync(join(OUT, "claude-draft-20.md"), sheet(entries.slice(COLD), "Claude draft: Remo reviews and corrects"));
  mkdirSync("eval/dev", { recursive: true });
  writeFileSync(
    COMMITTED,
    JSON.stringify(
      {
        seed: SEED,
        window: WINDOW,
        queries: QUERIES,
        coldCount: COLD,
        entries: entries.map(({ n, id, publicationNumber, publishedAt, lang, uid }) => ({ n, id, publicationNumber, publishedAt, lang, uid })),
      },
      null,
      2,
    ) + "\n",
  );
  addToLedger(entries, "assignment");
  console.log(`drew ${entries.length} entries (${discardedSealed} sealed-company publications discarded unseen)`);
}

const chf = (v: string) => Number(v).toLocaleString("de-CH", { minimumFractionDigits: 2 });

function sheet(entries: Entry[], heading: string): string {
  const head = [
    `# Assignment · ${heading}`,
    "",
    "Fill the three fields under each entry. Allowed values:",
    `- startup_relevance: ${STARTUP_RELEVANCE.join(" | ")}`,
    `- transaction_type: ${TRANSACTION_TYPES.join(" | ")}`,
    "- reason: one line. Do not copy person names into it (company-level only).",
    "",
    "Positive class (plan, eng V1): new money in this capital change (cash or mixed contribution).",
    "Set-off only (Verrechnung / compensation) is conversion_only, even with a new preferred class.",
    "",
  ];
  const body = entries.flatMap((e) => [
    `## A${String(e.n).padStart(2, "0")} · ${e.publicationNumber} · ${e.publishedAt} · ${e.lang}`,
    "",
    `**${e.company}** (${e.uid}) · nominal capital ${chf(e.capitalBefore)} → ${chf(e.capitalAfter)}`,
    "",
    `> ${e.text}`,
    "",
    `Purpose: ${e.purpose}`,
    "",
    "- startup_relevance: ",
    "- transaction_type: ",
    "- reason: ",
    "",
  ]);
  return [...head, ...body].join("\n");
}

/** A sheet must label exactly entries from..to, each once. */
function expectRange(labels: SheetLabel[], from: number, to: number, sheetName: string) {
  const ns = labels.map((l) => l.n).sort((a, b) => a - b);
  const want = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  if (JSON.stringify(ns) !== JSON.stringify(want)) {
    throw new Error(`${sheetName} must label A${from}–A${to} exactly once; found ${ns.join(", ")}`);
  }
}

function collect() {
  const entries: Entry[] = JSON.parse(readFileSync(ENTRIES, "utf8"));
  const remo = parseSheet(readFileSync(join(OUT, "remo-cold-10.md"), "utf8"));
  const reviewed = parseSheet(readFileSync(join(OUT, "claude-draft-20.md"), "utf8"));
  const blind = parseSheet(readFileSync(join(OUT, "claude-blind-10.md"), "utf8"));
  expectRange(remo, 1, COLD, "remo-cold-10.md");
  expectRange(blind, 1, COLD, "claude-blind-10.md");
  expectRange(reviewed, COLD + 1, entries.length, "claude-draft-20.md");
  const byN = new Map(entries.map((e) => [e.n, e]));
  const labels = [
    ...remo.map((l) => ({ ...l, labeler: "remo" as const })),
    ...reviewed.map((l) => ({ ...l, labeler: "claude_draft_remo_reviewed" as const })),
  ].map((l) => {
    const e = byN.get(l.n)!;
    return { ...l, id: e.id, uid: e.uid, provenance: "text_only", split: "dev" };
  });
  const agree = remo.filter((r) => {
    const b = blind.find((x) => x.n === r.n)!;
    return b.startup_relevance === r.startup_relevance && b.transaction_type === r.transaction_type;
  }).length;
  const out = JSON.stringify({ agreementOnCold: { agree, of: remo.length }, labels: labels.sort((a, b) => a.n - b.n) }, null, 2) + "\n";
  // Free-text reasons are committed: names copied from the gazette text must not get through.
  assertNoListedNames(LABELS, out, [...loadNameList(), ...entries.flatMap((e) => personNamesIn(e.text))]);
  writeFileSync(LABELS, out);
  console.log(`wrote ${labels.length} labels → ${LABELS}; Claude blind vs Remo on the cold set: ${agree}/${remo.length} agree on both axes`);
}

/** "Nachname, Vorname, von …" / "Nom, Prénom, de …" person segments in register text. */
function personNamesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/([A-ZÄÖÜÉÈ][\p{L}'-]+(?: [A-ZÄÖÜÉÈ][\p{L}'-]+)*), ([A-ZÄÖÜÉÈ][\p{L}'-]+(?: [A-ZÄÖÜÉÈ][\p{L}'-]+)*), (?:von|de|da|des|aus|in|à)\b/gu)) {
    out.push(`${m[2]} ${m[1]}`, `${m[1]} ${m[2]}`);
  }
  return out;
}

const [cmd] = process.argv.slice(2);
if (cmd === "draw") await draw();
else if (cmd === "collect") collect();
else {
  console.error("usage: assignment <draw|collect>");
  process.exit(1);
}
