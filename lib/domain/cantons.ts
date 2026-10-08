// Swiss cantons for the radar map and the feed's canton filter. Geometry: Natural Earth 1:10m
// admin-1 (public domain), projected once to a 1000 × 640 viewBox (scripts are in the PR notes).
import map from "./swiss-map.json";

export interface CantonShape {
  d: string;
  /** Centroid: where the blips cluster. */
  cx: number;
  cy: number;
  /** Label position, nudged where small cantons crowd (BL, AR, AI). */
  lx: number;
  ly: number;
}

export const SWISS_MAP = map as { attribution: string; viewBox: string; outline: string; inner: string; cantons: Record<string, CantonShape> };
export const CANTON_CODES = Object.keys(SWISS_MAP.cantons).sort();

/** The canton filter from a query value, or null for all of Switzerland. */
export function parseCanton(v: string | string[] | undefined): string | null {
  const s = typeof v === "string" ? v.toUpperCase() : null;
  return s && CANTON_CODES.includes(s) ? s : null;
}

/** Days the map looks back from asOf, asOf included. */
export const MAP_WINDOW_DAYS = 30;
