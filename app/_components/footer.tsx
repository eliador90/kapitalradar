import Link from "next/link";

// Every page (design J2, AS2). Release-level chrome only: nothing here depends on asOf.
// Source attribution and the "not official" notice are conditions of the SHAB portal's terms of
// use (§3.3) and of Zefix's OGD licence ("Open use. Must provide the source.").
export function Footer() {
  return (
    <footer className="footer">
      <Link href="/methodology">Methodology</Link>
      <Link href="/misses">Misses</Link>
      <a href="https://github.com/eliador90/kapitalradar" rel="noopener noreferrer" target="_blank">
        Source code
      </a>
      <span>
        Data: Swiss Official Gazette of Commerce (SOGC/SHAB),{" "}
        <a href="https://www.amtsblattportal.ch" rel="noopener noreferrer" target="_blank">
          Official Gazettes Portal
        </a>
        , SECO; company references:{" "}
        <a href="https://www.zefix.admin.ch" rel="noopener noreferrer" target="_blank">
          Zefix
        </a>
        , Federal Office of Justice.
      </span>
      <span>
        This is not an official publication. The authoritative data are those on the Official Gazettes Portal that bear the SECO electronic signature or
        stamp. Every entry links to its SHAB publication.
      </span>
    </footer>
  );
}
