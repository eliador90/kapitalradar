// Typed payloads of the legal events parsed from SHAB publications (plan "Data model").
import { z } from "zod";
import { contributionType, isoDate } from "./schemas";

export const CURRENCIES = ["CHF", "EUR", "USD", "GBP"] as const;
export const currency = z.enum(CURRENCIES);

export const shareClass = z.object({
  count: z.number().int().nonnegative(),
  /** Nominal value per share as a decimal string ("0.01"). */
  nominal: z.string(),
  currency,
  /** Class label as written ("Vorzugsaktien Seed", "Série A"), null for plain shares. */
  label: z.string().nullable(),
  preferred: z.boolean(),
});
export type ShareClass = z.infer<typeof shareClass>;

export const capitalChangePayload = z.object({
  direction: z.enum(["increase", "reduction", "unchanged"]),
  /** Reduction and re-increase in the same entry (hard negative). */
  restructuringPair: z.boolean(),
  /** The change happens inside a GmbH → AG conversion. */
  withConversion: z.boolean(),
  /** Issued under an existing capital band ("innerhalb des Kapitalbandes"). */
  withinCapitalBand: z.boolean(),
  paidBefore: z.string().nullable(),
  paidAfter: z.string().nullable(),
  classesBefore: z.array(shareClass).nullable(),
  classesAfter: z.array(shareClass).nullable(),
  /** Shares issued when the text states it ("par l'émission de N actions"). */
  sharesIssued: z.number().int().nullable(),
  setOffAmount: z.string().nullable(),
  setOffCurrency: currency.nullable(),
  /** A preferred class appears that was not there before; null when the previous classes are unknown. */
  newPreferredClass: z.boolean().nullable(),
  /** Nominal value per share changed (split/reverse split): no share-issuance figure. */
  nominalChanged: z.boolean(),
  /** Participation capital (Partizipationskapital) rather than share capital. */
  participationCapital: z.boolean(),
});
export type CapitalChangePayload = z.infer<typeof capitalChangePayload>;

export const conversionPayload = z.object({ fromLegalForm: z.string(), toLegalForm: z.string() });
export const capitalBandPayload = z.object({ action: z.enum(["adopted", "changed", "removed"]) });
export const formationPayload = z.object({ purpose: z.string(), foundedOn: isoDate });
export const nameChangePayload = z.object({ from: z.string(), to: z.string() });
export const cancellationPayload = z.object({ cancelsPublicationNumber: z.string() });

export const parsedEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("capital_change"),
    contributionType,
    currency,
    capitalBefore: z.string(),
    capitalAfter: z.string(),
    sharesBefore: z.number().int().nullable(),
    sharesAfter: z.number().int().nullable(),
    payload: capitalChangePayload,
  }),
  z.object({ type: z.literal("conversion_to_ag"), payload: conversionPayload }),
  z.object({ type: z.literal("capital_band"), payload: capitalBandPayload }),
  z.object({ type: z.literal("formation"), payload: formationPayload }),
  z.object({ type: z.literal("name_change"), payload: nameChangePayload }),
  z.object({ type: z.literal("cancellation"), payload: cancellationPayload }),
]);
export type ParsedEvent = z.infer<typeof parsedEvent>;
export type CapitalEvent = Extract<ParsedEvent, { type: "capital_change" }>;

/** Lower-cased labels of the preferred classes (one definition for "which preferred classes exist"). */
export const preferredLabels = (classes: readonly ShareClass[] | null) => new Set((classes ?? []).filter((c) => c.preferred).map((c) => (c.label ?? "").toLowerCase()));
