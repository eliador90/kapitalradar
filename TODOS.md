# TODOS

Deferred work with its reason. Keep this short: anything under ~10 minutes gets done inline, not filed.

## Deferred from /plan-ceo-review (2026-10-05)

- **Full-size eval.** Grow from a dev set of 30 Assignment + matched spike rounds / 30-round holdout cohort / one shared precision sample (n=30) to ~100 labels, a ~50-round cohort and a holdout precision sample per system (rules-only and rules + Claude). Why deferred: about 8 h of manual work against the build budget (spec review R2-19). Do it once v1 is live; no redesign needed, only more labels.
- **Weekly digest (RSS or email).** Financings registered each week, structured fields and gazette links only. Why deferred: little proof value for the hiring-manager audience; let feedback from the first VC partners decide RSS versus email (D3, /plan-ceo-review).
- **Apertus comparison.** Add the Swiss open LLM (Apertus, ETH/EPFL/CSCS) as a third system in the eval table, on the same redacted inputs. Why deferred: hosted access is unverified and could stall day 2 (D4, /plan-ceo-review). First follow-up after launch; verify a hosted provider first.
- **Ask Kapitalradar.** Constrained natural-language questions over the dataset (text-to-SQL through a read-only role), with an eval built from real VC partner questions. Why deferred: about 2 h over a full day-2 budget plus a new public prompt and SQL surface (D9, /plan-ceo-review).
- **Live daily ingestion (phase 2).** Turn the batch release pipeline into a daily GitHub Actions job: schedule + keepalive, classifier-version pins in URLs (`v=`), event/assessment versioning across releases, a stale-data email, weekday anomaly checks, and discovery of later corrections/cancellations for tracked companies (Codex X4). Why deferred: none of it is needed for rewind or the eval, and it carried most of the open engineering risk in a 3-day budget (D13, /plan-ceo-review outside voice).

## Deferred from /plan-design-review (2026-10-05)

- **Social link preview for the public launch.** Open Graph image (wordmark, one real ledger row, the "Published by" date) plus title and description per route.
  - **Why:** the LinkedIn post is a success criterion, and the preview card is what people see when the link is shared.
  - **Pros:** a credible card for about 20 minutes of CC work.
  - **Cons:** one more asset to maintain; worthless while the site is private.
  - **Context:** during the private preview the password gate hides every page from crawlers, so a card can't render anyway (D8, /plan-design-review).
  - **Blocked by:** Open Question 1 (SHAB reuse terms) and the public launch.
