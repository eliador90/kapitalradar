import { z } from "zod";
import { isoDate, uid } from "../../lib/domain/schemas";

export { isoDate, uid };

export const SCREENING_OUTCOMES = [
  "eligible",
  "roundup",
  "not_financing",
  "not_priced_equity",
  "not_swiss_entity",
  "ambiguous_entity",
  "not_ag",
  "duplicate_round",
] as const;
export const screeningOutcome = z.enum(SCREENING_OUTCOMES);

export const SCREENING_COLUMNS = [
  "rank",
  "announced",
  "title",
  "url",
  "company",
  "uid",
  "legal_form",
  "outcome",
  "note",
] as const;

export const candidate = z.object({ date: isoDate, title: z.string(), url: z.string().url() });
export const candidatesFile = z.object({
  crawledAt: z.string(),
  source: z.string(),
  window: z.object({ start: isoDate, end: isoDate }),
  candidates: z.array(candidate),
});

export const cohortRound = z.object({
  rank: z.number().int().positive(),
  uid,
  company: z.string(),
  announced: isoDate,
  url: z.string().url(),
  title: z.string(),
});
export type CohortRound = z.infer<typeof cohortRound>;

export const cohortFile = z.object({
  seed: z.number().int(),
  window: z.object({ start: isoDate, end: isoDate }),
  matchWindowDays: z.object({ before: z.number(), after: z.number() }),
  spike: z.array(cohortRound),
  cohort: z.array(cohortRound),
});
export type CohortFile = z.infer<typeof cohortFile>;

export const INSPECTED_SOURCES = ["spike", "assignment", "x1", "adhoc", "precision"] as const;
export const inspectedEntry = z.object({
  uid,
  company: z.string(),
  source: z.enum(INSPECTED_SOURCES),
  added: isoDate,
  note: z.string().optional(),
});
export type InspectedEntry = z.infer<typeof inspectedEntry>;
export const inspectedFile = z.object({ entries: z.array(inspectedEntry) });
