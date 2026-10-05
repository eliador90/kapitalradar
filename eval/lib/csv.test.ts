import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("csv", () => {
  it("round-trips quotes, commas and newlines", () => {
    const rows = [
      { a: 'say "hi"', b: "x,y" },
      { a: "line\nbreak", b: "" },
    ];
    expect(parseCsv(toCsv(["a", "b"], rows))).toEqual(rows);
  });

  it("parses CRLF and a BOM (Excel saves)", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
  });
});

describe("csv mid-field quotes", () => {
  it("keeps a quote inside an unquoted field literal", () => {
    expect(parseCsv('a,b\n5" display,x\n')).toEqual([{ a: '5" display', b: "x" }]);
  });
});
