// The public SHAB page of one publication (every entry links to it; design J2).
export function publicationUrl(id: string): string {
  return `https://amtsblattportal.ch/#!/search/publications/detail/${encodeURIComponent(id)}`;
}

/** An outside link from data (confirmation sources): https only, else null (rendered as text). */
export function httpsUrl(url: string): string | null {
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
