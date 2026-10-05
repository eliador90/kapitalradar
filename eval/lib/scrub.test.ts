import { describe, expect, it } from "vitest";
import { leftovers, scrub } from "./scrub";

const names = ["Anna Muster", "Jörg Beispiel", "Anna Muster-Meier"];

describe("scrub", () => {
  it("replaces names in text and URL slugs", () => {
    const text = "Jörg Beispiel invests https://x.test/en/news/jorg-beispiel-invests-in-anna-muster-co";
    expect(scrub(text, names)).toBe("<PERSON_2> invests https://x.test/en/news/person-2-invests-in-person-1-co");
  });

  it("catches German transliteration in slugs and text", () => {
    expect(scrub("/news/joerg-beispiel-steigt-ein", names)).toBe("/news/person-2-steigt-ein");
    expect(scrub("Joerg Beispiel steigt ein", names)).toBe("<PERSON_2> steigt ein");
  });

  it("replaces the longest overlapping name first, keeping each name's number", () => {
    expect(scrub("Anna Muster-Meier und Anna Muster", names)).toBe("<PERSON_3> und <PERSON_1>");
  });

  it("matches across non-breaking spaces but not inside other words", () => {
    expect(scrub("Anna Muster", names)).toBe("<PERSON_1>");
    expect(scrub("Joanna Musterli", names)).toBe("Joanna Musterli");
  });

  it("reports leftovers in every spelling", () => {
    expect(leftovers("joerg-beispiel raises", names)).toEqual(["Jörg Beispiel"]);
    expect(leftovers("Anna Muster raises", names)).toEqual(["Anna Muster"]);
    expect(leftovers(scrub("Anna Muster-Meier, Jörg Beispiel", names), names)).toEqual([]);
  });
});
