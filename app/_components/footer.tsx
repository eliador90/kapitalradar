import Link from "next/link";

// Every page (design J2, AS2). Release-level chrome only: nothing here depends on asOf.
export function Footer() {
  return (
    <footer className="footer">
      <Link href="/methodology">Methodology</Link>
      <Link href="/misses">Misses</Link>
      <span>Not an official publication. Every entry links to the SHAB.</span>
    </footer>
  );
}
