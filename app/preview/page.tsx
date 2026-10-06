import type { Metadata } from "next";
import { PREVIEW_LOGIN_PATH, safeNext } from "../../lib/preview-gate";

export const metadata: Metadata = { title: "Private preview · Kapitalradar" };

// The styled gate (design D4, DT8). Reads nothing from the database.
export default async function PreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  const failed = sp.error === "1";
  return (
    <main id="record" className="gate">
      <p className="wordmark">Kapitalradar</p>
      <h1 className="headline">Private preview</h1>
      <p>Swiss capital increases, classified with evidence from the official gazette.</p>
      <form method="post" action={PREVIEW_LOGIN_PATH}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus aria-describedby={failed ? "gate-error" : undefined} />
        {failed && (
          <p id="gate-error" className="error" role="alert">
            That password didn&rsquo;t match. Check the link you were sent.
          </p>
        )}
        <button className="button" type="submit">
          Open the record
        </button>
      </form>
    </main>
  );
}
