// The inspected-company ledger (eng V4) and the sealed set derived from it and the cohort.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cohortFile, inspectedFile, type InspectedEntry } from "./schemas";

export const INSPECTED = "eval/inspected.json";
export const COHORT = "eval/cohort.json";

export const today = () => new Date().toISOString().slice(0, 10);

export function readLedger(): InspectedEntry[] {
  return existsSync(INSPECTED) ? inspectedFile.parse(JSON.parse(readFileSync(INSPECTED, "utf8"))).entries : [];
}

export function writeLedger(entries: InspectedEntry[]) {
  writeFileSync(INSPECTED, JSON.stringify({ entries }, null, 2) + "\n");
}

/** Adds companies not yet in the ledger under `source`; returns how many were new. */
export function addToLedger(companies: readonly { uid: string; company: string }[], source: InspectedEntry["source"]): number {
  const ledger = readLedger();
  const known = new Set(ledger.map((e) => e.uid));
  let added = 0;
  for (const c of companies) {
    if (known.has(c.uid)) continue;
    known.add(c.uid);
    ledger.push({ uid: c.uid, company: c.company, source, added: today() });
    added++;
  }
  writeLedger(ledger);
  return added;
}

/** UIDs a new draw must never touch: the recall cohort and the spike set (plus, optionally, the ledger). */
export function sealedUids(opts: { includeLedger?: boolean } = {}): Set<string> {
  const c = cohortFile.parse(JSON.parse(readFileSync(COHORT, "utf8")));
  const uids = [...c.cohort, ...c.spike].map((r) => r.uid);
  if (opts.includeLedger) uids.push(...readLedger().map((e) => e.uid));
  return new Set(uids);
}

/** Cohort UIDs only: the companies whose gazette entries stay sealed until the freeze. */
export function cohortUids(): Set<string> {
  return new Set(cohortFile.parse(JSON.parse(readFileSync(COHORT, "utf8"))).cohort.map((r) => r.uid));
}
