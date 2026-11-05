import type { MetadataRoute } from "next";

// Static, so a crawler's first request never reaches the database. Plain URLs stay indexable,
// company pages included (decision log #51). Query strings are not: asof and the filters multiply
// every page into thousands of URLs. The three named crawlers made 37 % of the requests in the
// sample behind decision log #52 and bring no search visitors.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: ["SemrushBot", "Amazonbot", "meta-externalagent"], disallow: "/" },
      { userAgent: "*", allow: "/", disallow: "/*?*" },
    ],
  };
}
