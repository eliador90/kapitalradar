import { describe, expect, it } from "vitest";
import { parseArticle, parseFinancingList } from "./startupticker";

const item = (date: string, href: string, title: string) =>
  `<div class="list-content">\n\t\t<div class="date">${date} 08:27</div>\t\t<a href="${href}"><h2>${title}</h2></a>`;

describe("parseFinancingList", () => {
  it("parses both link forms and canonicalizes /index.php links", () => {
    const html =
      item("20.03.2026", "/index.php/en/news/mobilezone-uebernimmt-apfelkiste", "Mobilezone übernimmt Apfelkiste") +
      item("05.10.2026", "/en/news/a-b", "A &amp; B raise CHF 1 million");
    expect(parseFinancingList(html)).toEqual([
      {
        date: "2026-03-20",
        url: "https://www.startupticker.ch/en/news/mobilezone-uebernimmt-apfelkiste",
        title: "Mobilezone übernimmt Apfelkiste",
      },
      { date: "2026-10-05", url: "https://www.startupticker.ch/en/news/a-b", title: "A & B raise CHF 1 million" },
    ]);
  });
});

describe("parseArticle", () => {
  it("extracts title, body and linked companies", () => {
    const html =
      `<h1>Acme raises CHF 2 million</h1><div class="category mobile">x</div>` +
      `<p><p class="isselectedend">Acme closed a seed round.</p></p>` +
      `<p class="link-login">login</p><p><a class="link-arr" href="/en/companies/acme-ag">Acme AG</a></p>`;
    expect(parseArticle(html)).toEqual({
      title: "Acme raises CHF 2 million",
      body: "Acme closed a seed round.",
      companies: ["Acme AG"],
    });
  });
});
