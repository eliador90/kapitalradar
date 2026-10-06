# Decision log (build days)

Decisions taken during the build that the plan didn't settle, newest last. Each row says
whether it needs Remo's review. "Advisors" = independent subagent / Codex second opinions.

| # | Date | Area | Decision | Why | Review? |
|---|---|---|---|---|---|
| 1 | 2026-10-05 | T1 | Cohort window pinned to 2025-12-01..2026-04-08 (snapshot 2026-10-05 − 180 d) | Plan rule A1; Next-Steps text said Jun 2026 | approved |
| 2 | 2026-10-05 | T1 | Screening rules (roundups, Venture Kick payouts = not priced equity, registry-not-found = excluded) fixed in PREREGISTRATION.md before the crawl | Pre-registration | approved |
| 3 | 2026-10-06 | Privacy | Every cached company I read text from goes into the inspected ledger as `adhoc` (38 added) | V4: any ad hoc look excludes a company from the holdout | approved |
| 4 | 2026-10-06 | T4 | Restructuring pair = reduction + executed re-increase + same-operation/loss wording, not treasury-share cancellation | Review M1: the broad version dropped a real preferred round | yes |
| 5 | 2026-10-06 | T4 | "mixed" = non-cash (set-off or in kind) plus cash; set-off + in kind without cash is not mixed | V1 positive class needs new money | yes |
| 6 | 2026-10-06 | T4 | Conditional-capital *issuance* is its own contribution type; adopting the clause is not | Review H1 | no |
| 7 | 2026-10-06 | T5 | `company_sources` table (approved); founding date from HR01, else Zefix `status.neu`; Zefix refs reach back to ~2017 only, older companies get age "unknown" | Spike archive finding + eng Q4 | approved |
| 8 | 2026-10-06 | Process | Additive schema changes may be applied without asking (approved by Remo for this session) | Autonomous block | approved |
| 9 | 2026-10-06 | T6 | Two soft negatives added to the plan's catalog: `in_kind_only` (−1.5) and `conditional_capital_issuance` (−1.0) | Assignment: in-kind increases were restructurings (A01, A15); option exercises aren't rounds | yes |
| 10 | 2026-10-06 | T6 | Rule definitions: small nominal = ≤ CHF 1 with a non-round (≠ ×1'000) increase; ESOP-sized = < 2% new shares and no new preferred class; holding = purpose names participations/holding, no tech wording, increase a multiple of 10'000 | Plan names the rules, not the cut-offs | yes |
| 11 | 2026-10-06 | T6 | Rules-only threshold fitted by max F1 on dev (ties → higher): **1.0**; dev 43 labeled items, 21 positives: 21 TP / 5 FP / 0 FN. Weights kept at the provisional catalog values (too few dev items to fit 11 weights) | Plan: threshold chosen on dev | yes |
| 12 | 2026-10-06 | Labels | 16 spike dev labels drafted by Claude: relevance "yes" from the announcement, transaction type from the gazette contribution (15 new_equity, Axi Labs conversion_only); provenance verified with the startupticker URL. Caveat (reviewer): the transaction type comes from the same parser contribution that drives the set-off/in-kind/conditional rules, so the dev fit is partly self-confirming | Plan: matched spike rounds join the dev set | **yes: review `eval/dev/spike-labels.json`** |
| 13 | 2026-10-06 | T6 | Tech/holding purpose patterns made word-bounded after the review found false hits (Mandaten, Parzellen, Physiotherapie, "Entwicklung von Immobilien"); holding tested on the purpose's first sentence only. Dev rerun: 21 TP / 4 FP / 0 FN at threshold 1.0 | Review finding 1, 9 | no |
| 14 | 2026-10-06 | T5 | Founding date = earliest HR01 that is not a seat transfer, else the earliest Zefix `status.neu`; `formationFound` only when an HR01 is stored; age in calendar years | Review findings 3, 11, 12 | no |
| 15 | 2026-10-06 | T5 | Throughput: SHAB kept at 4 req/s (the binding limit, ~2 h for 2,976 companies); Zefix raised to 2 req/s; one DB write per company | Politeness vs. day-3 timing | no |
| 16 | 2026-10-06 | T5 | Rows written by the first history process (before the fixes) are re-derived with `npm run history -- --recompute` (no network) when the run ends; non-HR publications it stored got rubric "HR": to be corrected from the XML meta (label fix, raw XML untouched) | Review finding 7 | no |
| 17 | 2026-10-06 | T7 | τ_low = τ − 0.2 (abstain band 0.2 wide); τ = max-F1 classifier score on dev, capped at 0.95; frozen into `config/classification.json` | Plan: τ, τ_low chosen on dev | yes |
| 18 | 2026-10-06 | T7 | Classifier spawns `claude.exe` directly (no shell: empty `--tools ""` and the multi-line prompt were mangled through `claude.cmd`); context ceiling 4,000 input tokens; probe measured 2,660 | Plan "Context check" | no |
