// Tiny helpers for the flat SHAB HR export XML. T4's parser builds on these; no DOM needed.

import { decodeEntities as decode } from "./text";

/** Inner XML of the first <name>…</name> (namespace prefixes on the tag are not supported). */
export function section(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m?.[1];
}

/** Text of the element reached by walking nested sections, e.g. ["commonsNew", "capital", "nominal"]. */
export function textAt(xml: string, path: readonly string[]): string | undefined {
  let cur: string | undefined = xml;
  for (const name of path) {
    if (cur === undefined) return undefined;
    cur = section(cur, name);
  }
  return cur === undefined ? undefined : decode(cur.trim());
}

/** eCH-0097 legal form codes used in the HR export. */
export const LEGAL_FORM = { AG: "0106", GMBH: "0107" } as const;
