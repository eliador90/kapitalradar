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

const isConfirmed = (c: ConfirmationLink) =>
  c.eventMatch === "accepted" && (c.matchConfidence === "high" || c.reviewedAt !== null);
const isPossible = (c: ConfirmationLink) => !isConfirmed(c) && c.eventMatch !== "rejected";

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

