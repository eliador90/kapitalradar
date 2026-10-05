// Parser for the Markdown labeling sheets of the Assignment (scripts/assignment.ts).
import { z } from "zod";

export const STARTUP_RELEVANCE = ["yes", "no", "unknown"] as const;
export const TRANSACTION_TYPES = ["new_equity", "conversion_only", "restructuring", "esop", "unknown"] as const;

export const sheetLabel = z.object({
  n: z.number().int().positive(),
  startup_relevance: z.enum(STARTUP_RELEVANCE),
  transaction_type: z.enum(TRANSACTION_TYPES),
  reason: z.string().min(1),
});
export type SheetLabel = z.infer<typeof sheetLabel>;

/** One label per `## A<n> · …` block; throws on an empty or invalid field. */
export function parseSheet(md: string): SheetLabel[] {
  return md
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const field = (k: string) => block.match(new RegExp(`^- ${k}:[ \t]*(.*)$`, "m"))?.[1]?.trim() ?? "";
      const n = Number(block.match(/^A(\d+)/)?.[1]);
      const parsed = sheetLabel.safeParse({
        n,
        startup_relevance: field("startup_relevance"),
        transaction_type: field("transaction_type"),
        reason: field("reason"),
      });
      if (!parsed.success) throw new Error(`A${n}: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")} missing or invalid`);
      return parsed.data;
    });
}
