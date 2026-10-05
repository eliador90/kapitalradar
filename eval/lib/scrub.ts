// Replaces known natural-person names in committed eval files with scrub tokens (eng A6):
// <PERSON_n> in text, person-n in URL slugs. The name list lives in the gitignored
// .data/person-names.txt, one name per line. The file is APPEND-ONLY: line order fixes n, and
// reordering would renumber tokens already committed.
import { existsSync, readFileSync } from "node:fs";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
const transliterate = (s: string) =>
  s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Spellings of a name: as written, German transliteration (ö → oe), accents stripped (ö → o). */
function spellings(name: string): string[] {
  return [...new Set([name, stripAccents(transliterate(name)), stripAccents(name)])];
}

// Letters/digits must not touch the match, so "Joanna Musterli" never matches "Anna Muster".
const B_BEFORE = "(?<![\\p{L}\\p{N}])";
const B_AFTER = "(?![\\p{L}\\p{N}])";

function textPattern(name: string): RegExp {
  const alts = spellings(name).map((s) => s.split(/\s+/).map(escape).join("[\\s\\u00a0]+"));
  return new RegExp(`${B_BEFORE}(?:${alts.join("|")})${B_AFTER}`, "giu");
}

function slugPattern(name: string): RegExp {
  const alts = [...new Set(spellings(name).map((s) => slugify(stripAccents(s))))].map(escape);
  return new RegExp(`(?<![a-z0-9])(?:${alts.join("|")})(?![a-z0-9])`, "g");
}

/** Longest names first, so "Anna Muster-Meier" is replaced before "Anna Muster". */
const byLength = (names: readonly string[]) =>
  names.map((name, i) => ({ name, n: i + 1 })).sort((a, b) => b.name.length - a.name.length);

export function scrub(text: string, names: readonly string[]): string {
  let out = text;
  for (const { name, n } of byLength(names)) {
    out = out.replace(textPattern(name), `<PERSON_${n}>`).replace(slugPattern(name), `person-${n}`);
  }
  return out;
}

/** Names (in any spelling, as text or slug) still present. */
export function leftovers(text: string, names: readonly string[]): string[] {
  return names.filter((name) => textPattern(name).test(text) || slugPattern(name).test(text.toLowerCase()));
}

export function parseNameList(file: string): string[] {
  return file
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

export const NAMES_FILE = ".data/person-names.txt";

/** The name list; throws when it is missing, so a fresh clone can't pass a name check silently. */
export function loadNameList(path = NAMES_FILE): string[] {
  if (!existsSync(path)) throw new Error(`${path} is missing: the person-name check can't run without it`);
  return parseNameList(readFileSync(path, "utf8"));
}

/** Throws if any committed text still contains a listed name. */
export function assertNoListedNames(label: string, text: string, names: readonly string[]) {
  const found = leftovers(text, names);
  if (found.length) throw new Error(`${label} still names ${found.length} listed person(s): scrub before committing`);
}
