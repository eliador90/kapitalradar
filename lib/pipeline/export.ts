// Dataset export (CEO review E6/E6b, eng A9). One row per capital-change event of a release,
// structured fields only: no gazette text (purpose included), no person data, no eval labels.
// The gate runs before any file is written; it is not exposed anywhere until OQ1 clears.
import { publicationUrl } from "../domain/shab-link";
import { personDataHits } from "./clauses";

export const EXPORT_COLUMNS = [
  "uid",
  "company_name",
  "canton",
  "legal_form",
  "legal_date",
  "published_at",
  "shab_publication_number",
  "shab_url",
  "currency",
  "nominal_capital_before",
  "nominal_capital_after",
  "shares_before",
  "shares_after",
  "tier",
  "model_id",
  "prompt_version",
] as const;
export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;

export interface ExportSource {
  uid: string;
  /** Name as of the snapshot. */
  companyName: string;
  canton: string | null;
  legalForm: string | null;
  legalDate: string;
  publishedAt: string;
  publicationNumber: string;
  publicationId: string;
  currency: string | null;
  capitalBefore: string | null;
  capitalAfter: string | null;
  sharesBefore: number | null;
  sharesAfter: number | null;
  /** null = not assessed (history before the window, reductions). */
  tier: string | null;
}

export function exportRow(s: ExportSource, model: { modelId: string; promptVersion: string }): ExportRow {
  const str = (v: string | number | null) => (v === null ? "" : String(v));
  return {
    uid: s.uid,
    company_name: s.companyName,
    canton: str(s.canton),
    legal_form: str(s.legalForm),
    legal_date: s.legalDate,
    published_at: s.publishedAt,
    shab_publication_number: s.publicationNumber,
    shab_url: publicationUrl(s.publicationId),
    currency: str(s.currency),
    nominal_capital_before: str(s.capitalBefore),
    nominal_capital_after: str(s.capitalAfter),
    shares_before: str(s.sharesBefore),
    shares_after: str(s.sharesAfter),
    tier: s.tier ?? "not_assessed",
    model_id: s.tier ? model.modelId : "",
    prompt_version: s.tier ? model.promptVersion : "",
  };
}

/**
 * The blocking person-data gate: every cell is checked against the person-data patterns and the
 * private name list. Returns the violations; the caller writes nothing unless it is empty.
 */
export function exportGate(rows: readonly ExportRow[], names: readonly string[]): string[] {
  const out: string[] = [];
  const lowered = names.map((n) => n.toLowerCase()).filter((n) => n.length >= 4);
  rows.forEach((r, i) => {
    for (const [col, value] of Object.entries(r)) {
      if (!value || col === "shab_url") continue;
      for (const hit of personDataHits(value)) out.push(`row ${i + 1} ${col}: ${hit}`);
      const v = value.toLowerCase();
      if (lowered.some((n) => v.includes(n))) out.push(`row ${i + 1} ${col}: listed person name`);
    }
  });
  return out;
}
