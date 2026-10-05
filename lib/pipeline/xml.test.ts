import { describe, expect, it } from "vitest";
import { section, textAt } from "./xml";

const xml = `<root><commonsNew><company><name>Acme &amp; Co AG</name></company>
<capital><nominal>132231.38</nominal></capital></commonsNew>
<commonsActual><capital><nominal>100000.00</nominal></capital></commonsActual></root>`;

describe("xml helpers", () => {
  it("walks nested sections and decodes entities", () => {
    expect(textAt(xml, ["commonsNew", "company", "name"])).toBe("Acme & Co AG");
    expect(textAt(xml, ["commonsNew", "capital", "nominal"])).toBe("132231.38");
    expect(textAt(xml, ["commonsActual", "capital", "nominal"])).toBe("100000.00");
  });

  it("returns undefined for missing paths", () => {
    expect(textAt(xml, ["commonsNew", "purpose"])).toBeUndefined();
    expect(section(xml, "nope")).toBeUndefined();
  });
});
