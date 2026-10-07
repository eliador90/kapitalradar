// As-of leak check on whole responses (eng delta A12, V12). For sampled companies and rewind
// dates, fetches the rendered page (HTML incl. <head> and the RSC payload) from a running
// server and fails if anything published after asOf shows up: a later SHAB publication
// number, a later publication date, or a later company name. Release-level chrome (eval line,
// curated rewind link, release id/date) is the named allowlist below.
//
//   npm run leak-check -- --base http://localhost:3100 [--companies 40]
// Needs DATABASE_URL (same database as the server) and PREVIEW_PASSWORD.
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { companyNames, currentRelease, events, publications, releases } from "../db/schema";
import { addDays } from "../lib/domain/dates";
import { isCapitalIncrease } from "../lib/domain/events";
import { featuredRewind } from "../lib/domain/featured";
import { formatDate } from "../lib/domain/format";
import { mulberry32 } from "../eval/lib/seeded";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const BASE = arg("base", "http://localhost:3100");
const N = Number(arg("companies", "40"));

const [rel] = await db().select({ id: releases.id, snapshot: releases.snapshotDate, backfill: releases.backfillStart }).from(currentRelease).innerJoin(releases, eq(releases.id, currentRelease.releaseId));
if (!rel) throw new Error("no current release");

// Allowlist: release metadata that renders identically at every asOf.
const allowedDates = new Set([formatDate(rel.snapshot), formatDate(featuredRewind.asOf)]);

const login = await fetch(`${BASE}/preview/login`, { method: "POST", body: new URLSearchParams({ password: process.env.PREVIEW_PASSWORD ?? "", next: "/" }), redirect: "manual" });
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("login failed: check PREVIEW_PASSWORD");
const get = async (path: string) => {
  const res = await fetch(BASE + path, { headers: { cookie }, redirect: "manual" });
  return { status: res.status, body: await res.text() };
};

const uids = (await db().execute(sql`select distinct company_uid from events where release_id = ${rel.id} and published_at >= ${rel.backfill}`)).rows.map((r) => (r as { company_uid: string }).company_uid).sort();
const rand = mulberry32(20261006);
const sample = Array.from({ length: Math.min(N, uids.length) }, () => uids[Math.floor(rand() * uids.length)]!);

let checked = 0;
const failures: string[] = [];
for (const uid of [...new Set(sample)]) {
  const evs = await db().select({ publishedAt: events.publishedAt, number: publications.publicationNumber, type: events.type, before: events.capitalBefore, after: events.capitalAfter }).from(events).innerJoin(publications, eq(publications.id, events.publicationId)).where(and(eq(events.releaseId, rel.id), eq(events.companyUid, uid)));
  const names = await db().select({ name: companyNames.name, publishedAt: companyNames.publishedAt }).from(companyNames).where(and(eq(companyNames.releaseId, rel.id), eq(companyNames.companyUid, uid)));
  const dates = [...new Set(evs.map((e) => e.publishedAt).filter((d) => d >= rel.backfill))].sort();
  const firstIncrease = evs.filter((e) => e.type === "capital_change" && e.publishedAt >= rel.backfill && isCapitalIncrease(e.before, e.after)).map((e) => e.publishedAt).sort()[0];
  // Rewind to the day before each publication: that publication and everything later must be absent.
  for (const d of dates) {
    const asOf = addDays(d, -1);
    if (asOf < rel.backfill) continue;
    const earlierNames = new Set(names.filter((n) => n.publishedAt <= asOf).map((n) => n.name));
    for (const path of [`/c/${uid}?asof=${asOf}`, `/?asof=${asOf}&s=all`]) {
      const { status, body } = await get(path);
      checked++;
      if (status >= 300 && !(status === 404 && path.startsWith("/c/"))) failures.push(`${path}: HTTP ${status} (the check must read rendered pages)`);
      for (const e of evs) if (e.publishedAt > asOf && body.includes(e.number)) failures.push(`${path}: later publication ${e.number} (${e.publishedAt})`);
      for (const e of evs) {
        const later = formatDate(e.publishedAt);
        if (e.publishedAt > asOf && !allowedDates.has(later) && path.startsWith("/c/") && body.includes(later)) failures.push(`${path}: later date ${later}`);
      }
      for (const n of names) if (n.publishedAt > asOf && !earlierNames.has(n.name) && body.includes(n.name)) failures.push(`${path}: later name "${n.name}"`);
    }
    // Positive control: on its own publication day the entry is there (the check is not vacuous).
    // A page exists only from the company's first in-window capital increase on (A11), so earlier
    // dates have nothing to control.
    if (!firstIncrease || d < firstIncrease) continue;
    const { body } = await get(d === rel.snapshot ? `/c/${uid}` : `/c/${uid}?asof=${d}`);
    checked++;
    const own = evs.filter((e) => e.publishedAt === d);
    if (!own.some((e) => body.includes(e.number))) failures.push(`/c/${uid}?asof=${d}: control failed, ${own.map((e) => e.number).join(", ")} missing`);
  }
}
console.log(`leak check: ${checked} responses, ${failures.length} failures`);
for (const f of failures.slice(0, 30)) console.log(`  ${f}`);
process.exit(failures.length ? 1 : 0);
