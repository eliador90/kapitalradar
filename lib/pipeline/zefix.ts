// Zefix firm search, sealed: only identity fields leave this module. The search response
// also carries the company's last SHAB publication date and register-excerpt link; those
// would leak gazette information about sealed cohort companies, so they are dropped here.
import { z } from "zod";
import { fetchJson } from "./http";

const SEARCH_URL = "https://www.zefix.ch/ZefixREST/api/v1/firm/search.json";

export const ZEFIX_LEGAL_FORM_AG = 3;
export const ZEFIX_LEGAL_FORM_GMBH = 4;

const firmSchema = z.object({
  name: z.string(),
  uid: z.string().regex(/^CHE\d{9}$/),
  legalFormId: z.number().int(),
  legalSeat: z.string(),
  status: z.string(),
});

export type ZefixFirm = z.infer<typeof firmSchema>;

const responseSchema = z.object({ list: z.array(z.unknown()).optional() });

export async function searchFirms(name: string, maxEntries = 10): Promise<ZefixFirm[]> {
  const raw = responseSchema.parse(
    await fetchJson(SEARCH_URL, {
      minIntervalMs: 1000,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, languageKey: "en", maxEntries }),
      },
    }),
  );
  // z.object strips unknown keys, so shabDate / cantonalExcerptWeb never survive parsing.
  return (raw.list ?? []).map((f) => firmSchema.parse(f));
}

export function formatUid(uid: string): string {
  const d = uid.replace(/\D/g, "");
  return `CHE-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}`;
}
