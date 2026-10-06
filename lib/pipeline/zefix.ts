// Zefix firm search, sealed: only identity fields leave this module. The search response
// also carries the company's last SHAB publication date and register-excerpt link; those
// would leak gazette information about sealed cohort companies, so they are dropped here.
import { z } from "zod";
import { formatUid, isCanonicalUid } from "../domain/uid";
import { fetchJson, politeFetch } from "./http";

/** ~2 requests/s: a modest load on a public registry service. */
const ZEFIX_INTERVAL_MS = 500;
const SEARCH_URL = "https://www.zefix.ch/ZefixREST/api/v1/firm/search.json";

export const ZEFIX_LEGAL_FORM_AG = 3;
export const ZEFIX_LEGAL_FORM_GMBH = 4;

const firmSchema = z.object({
  name: z.string(),
  uid: z.string().refine(isCanonicalUid),
  legalFormId: z.number().int(),
  legalSeat: z.string(),
  status: z.string(),
});

export type ZefixFirm = z.infer<typeof firmSchema>;

const responseSchema = z.object({ list: z.array(z.unknown()).optional() });

export async function searchFirms(name: string, maxEntries = 10): Promise<ZefixFirm[]> {
  const res = await politeFetch(SEARCH_URL, {
    minIntervalMs: ZEFIX_INTERVAL_MS,
    passStatuses: [404], // Zefix answers 404 when nothing matches
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name, languageKey: "en", maxEntries }),
    },
  });
  if (res.status === 404) {
    // Only Zefix's "no result" body means no match; any other 404 (moved endpoint) throws.
    const body = await res.text();
    if (body.includes("API.ZFR.SEARCH.NORESULT")) return [];
    throw new Error(`Zefix search 404 without the no-result body: ${body.slice(0, 200)}`);
  }
  const raw = responseSchema.parse(await res.json());
  // z.object strips unknown keys, so shabDate / cantonalExcerptWeb never survive parsing.
  return (raw.list ?? []).map((f) => firmSchema.parse(f));
}

// ---- dated publication references (T5 fallback; plan: never Zefix's current-state fields) ----

export interface ZefixRef {
  date: string;
  shabId: number;
  /** Zefix change keys, e.g. "kapitalaenderung.nominell"; "status.neu" marks the formation. */
  mutationTypes: string[];
}

export const ZEFIX_FORMATION = "status.neu";

const refSchema = z.object({
  shabDate: z.string(),
  shabId: z.number(),
  mutationTypes: z.array(z.object({ key: z.string() })).nullable().optional(),
});

/**
 * The dated SHAB references Zefix lists for a UID: dates, ids and change types only. The
 * message text is dropped here (it names people). Null when Zefix doesn't know the UID.
 */
export async function zefixPublicationRefs(uid: string): Promise<ZefixRef[] | null> {
  const res = await politeFetch(SEARCH_URL, {
    minIntervalMs: ZEFIX_INTERVAL_MS,
    passStatuses: [404],
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name: formatUid(uid), languageKey: "en", maxEntries: 5 }),
    },
  });
  if (res.status === 404) {
    const body = await res.text();
    if (body.includes("API.ZFR.SEARCH.NORESULT")) return null;
    throw new Error(`Zefix search 404 without the no-result body: ${body.slice(0, 200)}`);
  }
  const list = z.object({ list: z.array(z.object({ uid: z.string(), ehraid: z.number() })).optional() }).parse(await res.json()).list ?? [];
  const firm = list.find((f) => f.uid === uid);
  if (!firm) return null;
  const refs = z.array(refSchema).parse(await fetchJson(`https://www.zefix.ch/ZefixREST/api/v1/firm/${firm.ehraid}/shabPub.json`, { minIntervalMs: ZEFIX_INTERVAL_MS }));
  return refs.map((r) => ({ date: r.shabDate.slice(0, 10), shabId: r.shabId, mutationTypes: (r.mutationTypes ?? []).map((m) => m.key) }));
}

