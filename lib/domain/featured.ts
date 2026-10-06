// The one curated rewind link on the first screen (design D5/J1). Picked from inspected
// companies only (spike or X1 evidence), never the sealed cohort or a holdout. Release-level
// chrome: the same text at every asOf (eng delta A12 allowlist).
import { z } from "zod";
import featured from "../../eval/featured-rewind.json";
import { daysBetween } from "./dates";
import { formatDate } from "./format";
import { isoDate, uid } from "./schemas";

export const featuredRewind = z.object({ uid, company: z.string(), asOf: isoDate, announced: isoDate, source: z.string() }).parse(featured);

export const featuredRewindText = (f = featuredRewind) =>
  `Try a rewind: ${f.company} on ${formatDate(f.asOf)}, ${daysBetween(f.asOf, f.announced)} days before the round was announced`;
