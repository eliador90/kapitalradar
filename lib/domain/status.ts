// The one place status is derived (design DS1, eng delta Q7/V10). The confirmed tier is never
// stored: it comes from a confirmation visible at asOf whose event match is accepted, and a
// low-confidence company match counts only once a person has reviewed it.
import type { EventMatch, MatchConfidence, Tier } from "./schemas";

export type StatusState =
  | "capital_increased"
  | "abstain"
  | "likely_financing"
  | "confirmed"
  | "confirmed_missed"
  | "possible_confirmation"
  | "not_assessed";

export interface ConfirmationLink {
  eventMatch: EventMatch;
  matchConfidence: MatchConfidence;
  /** ISO timestamp of the manual review; null = not reviewed. */
  reviewedAt: string | null;
}

export interface Status {
  state: StatusState;
  /** Glyphs in ink, aria-hidden; the label carries the meaning. Empty for "not assessed". */
  pips: string;
  label: string;
}

const TIER_STATUS: Record<Tier, Status> = {
  capital_increased: { state: "capital_increased", pips: "○○○", label: "Capital increased" },
  abstain: { state: "abstain", pips: "◐○○", label: "Capital increased · undecided" },
  likely_financing: { state: "likely_financing", pips: "●●○", label: "Likely financing" },
};
/** System positive for rules + Claude (one definition, plan "System positive"). */
export const isClassifierPositive = (tier: Tier | null) => tier === "likely_financing";

const NOT_ASSESSED: Status = { state: "not_assessed", pips: "", label: "Not assessed" };

/** An accepted match that counts: high confidence, or low confidence once reviewed. */
export const isConfirmed = (c: ConfirmationLink) =>
  c.eventMatch === "accepted" && (c.matchConfidence === "high" || c.reviewedAt !== null);
const isPossible = (c: ConfirmationLink) => !isConfirmed(c) && c.eventMatch !== "rejected";

/** Feed filter groups (design D7); the default shows likely financings and confirmed rounds. */
export const FEED_FILTERS = [
  { key: "likely", label: "Likely financing", plural: "likely financings" },
  { key: "confirmed", label: "Confirmed round", plural: "confirmed rounds" },
  { key: "undecided", label: "Undecided", plural: "undecided increases" },
  { key: "increased", label: "Capital increased", plural: "other capital increases" },
] as const;

/** "likely financings or confirmed rounds" (design ST1 copy). */
export function feedFilterPhrase(filters: readonly FeedFilter[], joiner: "or" | "and" = "or"): string {
  const words = FEED_FILTERS.filter((f) => filters.includes(f.key)).map((f) => f.plural);
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} ${joiner} ${words.at(-1)}`;
}
export type FeedFilter = (typeof FEED_FILTERS)[number]["key"];
export const DEFAULT_FEED_FILTERS: readonly FeedFilter[] = ["likely", "confirmed"];

/** A possible confirmation stays in its tier's group: only an accepted match moves a row. */
export function feedFilterOf(status: Status, tier: Tier | null): FeedFilter {
  if (status.state === "confirmed" || status.state === "confirmed_missed") return "confirmed";
  if (tier === "likely_financing") return "likely";
  if (tier === "abstain") return "undecided";
  return "increased";
}

/** Parses `?s=likely&s=confirmed` (or `s=all`); unknown values are dropped, none means the default. */
export function parseFeedFilters(raw: string | string[] | undefined): { filters: FeedFilter[]; isDefault: boolean } {
  const values = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => v.split(","));
  const all = FEED_FILTERS.map((f) => f.key);
  const picked = values.includes("all") ? all : all.filter((k) => values.includes(k));
  const filters = picked.length ? picked : [...DEFAULT_FEED_FILTERS];
  const isDefault = filters.length === DEFAULT_FEED_FILTERS.length && DEFAULT_FEED_FILTERS.every((f) => filters.includes(f));
  return { filters, isDefault };
}

/** The canonical `s` value: null for the default, "all" for every group, else the keys in order. */
export function feedFilterParam(filters: readonly FeedFilter[]): string | null {
  const keys = FEED_FILTERS.map((f) => f.key).filter((k) => filters.includes(k));
  if (keys.length === DEFAULT_FEED_FILTERS.length && DEFAULT_FEED_FILTERS.every((f) => keys.includes(f))) return null;
  return keys.length === FEED_FILTERS.length ? "all" : keys.join(",");
}

/**
 * @param tier the event's assessment tier, or null when the event has no assessment
 * @param confirmations confirmations matched to this event and visible at asOf
 */
export function deriveStatus(tier: Tier | null, confirmations: readonly ConfirmationLink[]): Status {
  const base = tier ? TIER_STATUS[tier] : NOT_ASSESSED;
  if (confirmations.some(isConfirmed)) {
    return !isClassifierPositive(tier)
      ? { state: "confirmed_missed", pips: "●●●", label: "Confirmed round · missed by classifier" }
      : { state: "confirmed", pips: "●●●", label: "Confirmed round" };
  }
  if (confirmations.some(isPossible)) {
    return { state: "possible_confirmation", pips: base.pips, label: `${base.label} · possible confirmation` };
  }
  return base;
}

