// Pure as-of view logic shared by the readers (tested without a database): which rows a visitor
// may see at `asOf`, and how cancellations, corrections and names fold.
import { isVisibleAt } from "../domain/asof";

export interface DatedEvent {
  id: string;
  publicationId: string;
  publicationNumber: string;
  publishedAt: string;
  type: string;
  cancelsPublicationNumber: string | null;
  correctsPublicationNumber: string | null;
}

/**
 * Events visible at asOf: published on or before asOf, minus events of publications cancelled by
 * a cancellation that is itself visible at asOf (from its published_at onward, plan "Cancellations").
 */
export function visibleEvents<T extends DatedEvent>(events: readonly T[], asOf: string): T[] {
  const visible = events.filter((e) => isVisibleAt(e.publishedAt, asOf));
  const cancelled = new Set(visible.filter((e) => e.type === "cancellation" && e.cancelsPublicationNumber).map((e) => e.cancelsPublicationNumber!));
  return visible.filter((e) => e.type !== "cancellation" && !cancelled.has(e.publicationNumber));
}

/** Publication numbers corrected by a correction visible at asOf ("Corrected on <date> ↓"). */
export function correctedAt(events: readonly DatedEvent[], asOf: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) if (e.correctsPublicationNumber && isVisibleAt(e.publishedAt, asOf)) out.set(e.correctsPublicationNumber, e.publishedAt);
  return out;
}

/** The name a company carried at asOf: the latest name row published on or before it. */
export function nameAt(names: readonly { name: string; publishedAt: string }[], asOf: string): string | null {
  let best: { name: string; publishedAt: string } | null = null;
  for (const n of names) if (isVisibleAt(n.publishedAt, asOf) && (!best || n.publishedAt >= best.publishedAt)) best = n;
  return best?.name ?? null;
}
