// Zefix firm search, sealed: only identity fields leave this module. The search response
// also carries the company's last SHAB publication date and register-excerpt link; those
// would leak gazette information about sealed cohort companies, so they are dropped here.
import { z } from "zod";
import { isCanonicalUid } from "../domain/uid";
import { politeFetch } from "./http";

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
    minIntervalMs: 1000,
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

