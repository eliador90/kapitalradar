import { describe, expect, it } from "vitest";
import { EXPORT_COLUMNS, exportGate, exportRow, type ExportSource } from "./export";

const src: ExportSource = {
  uid: "CHE453478419",
  companyName: "Soverli AG",
  canton: "ZH",
  legalForm: "0106",
  legalDate: "2025-09-15",
  publishedAt: "2025-09-24",
  publicationNumber: "HR02-1006440626",
  publicationId: "abc",
  currency: "CHF",
  capitalBefore: "100000",
  capitalAfter: "132893",
  sharesBefore: 100000,
  sharesAfter: 132893,
  tier: "likely_financing",
};
const model = { modelId: "claude-opus-5-5", promptVersion: "1" };

describe("dataset export", () => {
  it("writes exactly the documented columns, with model fields only for assessed rows", () => {
    const row = exportRow(src, model);
    expect(Object.keys(row)).toEqual([...EXPORT_COLUMNS]);
    expect(row.model_id).toBe("claude-opus-5-5");
    const history = exportRow({ ...src, tier: null }, model);
    expect(history.tier).toBe("not_assessed");
    expect(history.model_id).toBe("");
  });

  it("passes clean rows through the gate", () => {
    expect(exportGate([exportRow(src, model)], ["Maxima Mustermann"])).toEqual([]);
  });

  it("blocks a listed person name in any cell", () => {
    const leaked = exportRow({ ...src, companyName: "Maxima Mustermann Consulting AG" }, model);
    expect(exportGate([leaked], ["Maxima Mustermann"])).toEqual(["row 1 company_name: listed person name"]);
  });
});
