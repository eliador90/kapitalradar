import { PgDialect } from "drizzle-orm/pg-core";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { visibleAt } from "./predicates";
import * as s from "./schema";

describe("db schema", () => {
  it("renders the as-of predicate as release equality plus inclusive date bound", () => {
    const q = new PgDialect().sqlToQuery(visibleAt(s.events, "r1", "2026-09-29"));
    expect(q.sql).toBe('("events"."release_id" = $1 and "events"."published_at" <= $2)');
    expect(q.params).toEqual(["r1", "2026-09-29"]);
  });

  it("puts release_id on every derived table and leads its indexes with it (eng delta P3)", () => {
    for (const t of [s.events, s.companyNames, s.assessments, s.confirmations]) {
      const cfg = getTableConfig(t);
      expect(cfg.columns.map((c) => c.name)).toContain("release_id");
      for (const idx of cfg.indexes) {
        const first = idx.config.columns[0] as { name?: string };
        expect(first.name, `${cfg.name}.${idx.config.name}`).toBe("release_id");
      }
    }
  });

  it("stores every published_at as a date", () => {
    for (const t of [s.publications, s.events, s.companyNames, s.confirmations]) {
      const col = getTableConfig(t).columns.find((c) => c.name === "published_at");
      expect(col?.getSQLType()).toBe("date");
    }
  });
});
