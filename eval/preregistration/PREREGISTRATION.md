# Eval pre-registration (T1)

Committed before any candidate list was crawled, so neither the seed nor the rules below
could be chosen after seeing the candidates. Source of the design: `docs/designs/kapitalradar.md`,
"Labels and evaluation" and eng review A1, T4, V2, V4.

## Fixed parameters

| Parameter | Value |
|---|---|
| Seed | `2613906888` (32-bit, drawn with `crypto.randomBytes` on 2026-10-05) |
| PRNG | mulberry32, Fisher–Yates shuffle (`eval/lib/seeded.ts`) |
| Pinned snapshot for the window | 2026-10-05 |
| Announcement window | 2025-12-01 to 2026-04-08 inclusive (snapshot − 180 days) |
| Match window (event vs. announcement) | −120 / +180 days |
| Spike set | first 20 eligible rounds in seeded order (dev) |
| Recall cohort | next 30 eligible rounds in seeded order (holdout, sealed) |
| Fallback (eng V2) | only if day 2 ends behind: the first 20 cohort rounds in this order |

A later release snapshot does not move the window; the committed window stays.

## Candidate pool

Every article in startupticker.ch's "Financing" category (`/en/topics?category=Financing`)
whose list date falls inside the window, deduplicated by article URL, sorted by URL, then
shuffled with the seed. The crawl respects the site's `Crawl-Delay: 5`.

## Screening (in seeded order, stop at 50 eligible)

Each candidate gets exactly one outcome. The first matching exclusion is logged.

1. `roundup`: the article reports several companies' financings. Excluded (one round per article).
2. `not_financing`: no new financing of a company (award, grant, programme, exit, M&A, fund close, partnership).
3. `not_priced_equity`: the instrument is a grant, loan, debt, venture debt, convertible loan or note, SAFE, or reward crowdfunding. Equity crowdinvesting counts as priced equity.
4. `not_swiss_entity`: no Swiss commercial-register entity matches the company (foreign parent, not found).
5. `ambiguous_entity`: several registry entities fit and the article cannot decide between them.
6. `not_ag`: the matched entity's registry legal form is not an AG (`legalFormId` 3). GmbH is out of v1.
7. `duplicate_round`: the same round was already screened from another article.

Otherwise the round is `eligible`.

**Seal.** The registry lookup reads only name, UID, legal form, seat and status from Zefix's
firm search. It never opens the company's SHAB publication list, its excerpt or its
last-publication date; the lookup code drops those fields before they are written or displayed.
No gazette entry of a screened company is opened until the rules and τ are frozen.

## Partitions

- **Grouped by company:** a company's rounds never cross partitions. If an eligible round's UID
  is already assigned, the round joins that partition and does not count toward the other's quota.
- **Inspected-company ledger** (`eval/inspected.json`): spike companies, Assignment companies, X1
  claim-check companies and any ad hoc lookup. Ledger companies are dev-only and never holdout.
- **Holdout** = every UID not in the ledger. The recall cohort must not intersect the ledger;
  `scripts/preregister.ts check` enforces it, and the Assignment and X1 samplers skip cohort UIDs.

## Outputs

- `eval/preregistration/candidates.json`: the crawled pool (date, title, URL).
- `eval/preregistration/screening.csv`: every screened candidate in seeded order with its outcome.
- `eval/cohort.json`: spike set and recall cohort (company, UID, announcement date, URL).
- `eval/inspected.json`: the ledger.
