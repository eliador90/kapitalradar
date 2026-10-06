"use client";

// Database or render failure (design ST1). Next.js sends this with HTTP 500 (eng delta V11b).
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="record" className="reading">
      <h1 className="headline">The record couldn&rsquo;t be loaded</h1>
      <p>The data hasn&rsquo;t changed; try again in a minute.</p>
      <button className="button" type="button" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
