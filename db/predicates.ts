// The as-of + release predicate in SQL, the twin of lib/domain/asof.ts isVisibleAt. Every
// reader of a release-scoped, dated table filters through this; the leak test covers it.
import { and, eq, lte, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export function visibleAt(
  cols: { releaseId: PgColumn; publishedAt: PgColumn },
  releaseId: string,
  asOf: string,
): SQL {
  return and(eq(cols.releaseId, releaseId), lte(cols.publishedAt, asOf))!;
}
