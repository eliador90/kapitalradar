// Share issuance for one capital step (plan "Company page", CEO review X5): new shares as a
// share of all shares after the step, across classes. A share-count measure, not investor
// dilution or economic ownership. Steps where the figure would mislead get a reason instead.
import type { CapitalChangePayload } from "./events";

/** The payload fields that decide whether a figure is shown (all optional on stored payloads). */
export type IssuancePayload = Partial<Pick<CapitalChangePayload, "direction" | "restructuringPair" | "withConversion" | "nominalChanged">>;
export type IssuanceInput = IssuancePayload & { sharesBefore: number | null; sharesAfter: number | null };

export type Issuance = { kind: "figure"; newShares: number; fraction: number } | { kind: "none"; reason: string };

export function shareIssuance(s: IssuanceInput): Issuance {
  if (s.withConversion) return { kind: "none", reason: "conversion to an AG" };
  if (s.restructuringPair) return { kind: "none", reason: "shares cancelled and reissued" };
  if (s.direction === "reduction") return { kind: "none", reason: "capital reduction" };
  if (s.nominalChanged) return { kind: "none", reason: "nominal value per share changed" };
  if (s.sharesBefore === null || s.sharesAfter === null) return { kind: "none", reason: "share counts not published" };
  const newShares = s.sharesAfter - s.sharesBefore;
  if (newShares <= 0 || s.sharesAfter <= 0) return { kind: "none", reason: "no new shares" };
  return { kind: "figure", newShares, fraction: newShares / s.sharesAfter };
}
