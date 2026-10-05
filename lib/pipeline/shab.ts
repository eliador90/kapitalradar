// SHAB REST client (amtsblattportal.ch): keyless JSON search + XML per publication.
// Raw XML contains natural-person data; callers cache it only under the gitignored .data/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { formatUid } from "../domain/uid";
import { fetchJson, fetchText } from "./http";

const API = "https://amtsblattportal.ch/api/v1/publications";
const MIN_INTERVAL_MS = 500;
const CACHE_DIR = ".data/shab";

const metaSchema = z.object({
  id: z.string().uuid(),
  publicationNumber: z.string(),
  publicationDate: z.string(),
  language: z.string(),
  subRubric: z.string(),
  cantons: z.array(z.string()).nullable().optional(),
  title: z.record(z.string(), z.string().nullable()).optional(),
});
export type PublicationMeta = z.infer<typeof metaSchema> & { publishedAt: string };

const pageSchema = z.object({
  content: z.array(z.object({ meta: metaSchema })),
  total: z.number(),
});

export interface SearchParams {
  keyword?: string;
  subRubrics?: string[];
  /** Inclusive ISO dates. */
  start?: string;
  end?: string;
}

export async function searchPage(params: SearchParams, page: number, size = 100) {
  const q = new URLSearchParams({
    publicationStates: "PUBLISHED",
    tenant: "shab",
    "pageRequest.page": String(page),
    "pageRequest.size": String(size),
  });
  if (params.keyword) q.set("keyword", params.keyword);
  if (params.subRubrics?.length) q.set("subRubrics", params.subRubrics.join(","));
  if (params.start) q.set("publicationDate.start", params.start);
  if (params.end) q.set("publicationDate.end", params.end);
  const res = pageSchema.parse(await fetchJson(`${API}?${q}`, { minIntervalMs: MIN_INTERVAL_MS }));
  return {
    total: res.total,
    items: res.content.map(({ meta }) => ({ ...meta, publishedAt: meta.publicationDate.slice(0, 10) })),
  };
}

/** All results for a query; throws if the API stops before `total` (no silent truncation). */
export async function searchAll(params: SearchParams, size = 100): Promise<PublicationMeta[]> {
  const out: PublicationMeta[] = [];
  for (let page = 0; ; page++) {
    const { total, items } = await searchPage(params, page, size);
    out.push(...items);
    if (out.length >= total) return out;
    if (items.length === 0) throw new Error(`SHAB search ended at ${out.length}/${total}: ${JSON.stringify(params)}`);
  }
}

/**
 * Publications whose text mentions a UID (keyword search on the formatted UID). This includes
 * other companies' entries that merely cite it (mergers, parents, auditors): callers keep only
 * those whose XML company UID matches (readCapital().uid).
 */
export async function searchByUid(uid: string): Promise<PublicationMeta[]> {
  return searchAll({ keyword: formatUid(uid) });
}

/**
 * Publication XML. With `cache: false` nothing is written, so sealed-cohort guards can check
 * the UID first and call cachePublicationXml only for allowed companies.
 */
export async function fetchPublicationXml(id: string, opts: { cache?: boolean } = {}): Promise<string> {
  const file = join(CACHE_DIR, `${id}.xml`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const xml = await fetchText(`${API}/${id}/xml`, { minIntervalMs: MIN_INTERVAL_MS });
  if (!xml.includes("<publication")) throw new Error(`not a publication XML: ${id}`);
  if (opts.cache !== false) cachePublicationXml(id, xml);
  return xml;
}

export function cachePublicationXml(id: string, xml: string) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, `${id}.xml`), xml);
}

export function publicationUrl(id: string): string {
  return `https://amtsblattportal.ch/#!/search/publications/detail/${id}`;
}
