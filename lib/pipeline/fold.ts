// Folds a company's publications into as-of state for each capital change (T5). Features for
// an event read only publications on or before that event's publication day (plan "Feature
// rule"), so the fold walks forward in publication order and never looks ahead.
import { ageBucket, type AgeBucket } from "../domain/coverage";
import { preferredLabels, type CapitalEvent, type ShareClass } from "../domain/events";
import type { ParsedPublication } from "./parse";

export interface CapitalContext {
  publicationNumber: string;
  /** Shares before, filled from the previous capital event when the entry didn't state it. */
  sharesBefore: number | null;
  sharesBeforeSource: "entry" | "previous_event" | "unknown";
  /** New preferred class, decided against the previous event's classes when the entry couldn't. */
  newPreferredClass: boolean | null;
  foundedOn: string | null;
  ageBucket: AgeBucket;
  /** A capital band was in force before this event (adopted earlier and not removed). */
  priorCapitalBand: boolean;
  /** The company converted from GmbH to AG before this event. */
  convertedBefore: boolean;
}

type FoldInput = Pick<ParsedPublication, "publicationNumber" | "publishedAt" | "legalDate" | "events">;

const nominals = (classes: ShareClass[] | null) => new Set((classes ?? []).map((c) => c.nominal));
const sameNominals = (a: ShareClass[] | null, b: ShareClass[] | null) => {
  const x = nominals(a);
  const y = nominals(b);
  return x.size > 0 && x.size === y.size && [...x].every((n) => y.has(n));
};

/**
 * @param pubs one company's publications, any order
 * @param foundedOn founding date from company_sources (HR01 or Zefix), used once it is past
 */
export function foldCapitalContext(pubs: readonly FoldInput[], foundedOn: string | null): Map<string, CapitalContext> {
  const ordered = [...pubs].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.publicationNumber.localeCompare(b.publicationNumber));
  const out = new Map<string, CapitalContext>();
  let previous: CapitalEvent | null = null;
  let band = false;
  let converted = false;
  let founded: string | null = null;
  for (const p of ordered) {
    // The earliest formation wins (a later HR01 can be a re-registration).
    for (const e of p.events) if (e.type === "formation") founded ??= e.payload.foundedOn;
    const knownFounding = founded ?? (foundedOn && foundedOn <= p.publishedAt ? foundedOn : null);
    for (const e of p.events) {
      if (e.type !== "capital_change") continue;
      // Chain from the previous step only when nothing unrecorded can sit between them: capital
      // lines up, and (when both list classes) the nominal values are the same (no silent split).
      const continuous =
        previous !== null &&
        previous.capitalAfter === e.capitalBefore &&
        (previous.payload.classesAfter === null || e.payload.classesAfter === null || sameNominals(previous.payload.classesAfter, e.payload.classesAfter));
      let sharesBefore = e.sharesBefore;
      let source: CapitalContext["sharesBeforeSource"] = sharesBefore === null ? "unknown" : "entry";
      if (sharesBefore === null && continuous && previous!.sharesAfter !== null) {
        sharesBefore = previous!.sharesAfter;
        source = "previous_event";
      }
      let newPreferredClass = e.payload.newPreferredClass;
      if (newPreferredClass === null && continuous && e.payload.classesAfter && previous!.payload.classesAfter?.length) {
        const before = preferredLabels(previous!.payload.classesAfter);
        newPreferredClass = [...preferredLabels(e.payload.classesAfter)].some((k) => !before.has(k));
      }
      out.set(p.publicationNumber, {
        publicationNumber: p.publicationNumber,
        sharesBefore,
        sharesBeforeSource: source,
        newPreferredClass,
        foundedOn: knownFounding,
        ageBucket: ageBucket(knownFounding, p.legalDate),
        priorCapitalBand: band,
        convertedBefore: converted,
      });
    }
    // State changes take effect after this entry's own capital events are read.
    for (const e of p.events) {
      if (e.type === "capital_band") band = e.payload.action !== "removed";
      if (e.type === "conversion_to_ag") converted = true;
      if (e.type === "capital_change") previous = e;
    }
  }
  return out;
}
