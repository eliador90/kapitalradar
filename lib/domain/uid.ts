// Swiss enterprise identification number (UID). Canonical form: "CHE" + 9 digits.

const CANONICAL = /^CHE\d{9}$/;

/** Parses user or source input ("CHE-123.456.789", "che123456789", " CHE 123 456 789") → canonical, or null. */
export function normalizeUid(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s.\-]/g, "");
  return CANONICAL.test(compact) ? compact : null;
}

/** "CHE123456789" → "CHE-123.456.789". */
export function formatUid(uid: string): string {
  const d = uid.replace(/\D/g, "");
  return `CHE-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}`;
}

export const isCanonicalUid = (s: string) => CANONICAL.test(s);

/** A UID from a URL path segment; malformed percent-encoding counts as no UID. */
export function uidFromPathSegment(segment: string): string | null {
  try {
    return normalizeUid(decodeURIComponent(segment));
  } catch {
    return null;
  }
}
