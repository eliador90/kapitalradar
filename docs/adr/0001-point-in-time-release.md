# ADR 0001: point-in-time release store

Status: accepted (CEO review approach B, eng review V3, eng delta A14/V13)

## Context

The product's claim is that a financing round is visible in the official record before it is
announced. A visitor must be able to rewind to any date and see exactly what the gazette had
published by then, and the evaluation must be reproducible against a fixed dataset. Rebuilding
data in place would change what a past date shows and silently move the published metrics.

## Decision

- Every derived row (`events`, `company_names`, `assessments`, `confirmations`) carries a
  `release_id`. A release is built once, from cached raw publications and cached
  classifications, and never edited.
- One `current_release` row points at the live release. `scripts/build-release.ts` writes a new
  release, runs the gates, and flips the pointer in one transaction only if they pass. A failed
  build is marked failed and leaves the live release untouched. `--rollback` re-points.
- Reads filter `release_id = current AND published_at ≤ asOf` through one predicate
  (`db/predicates.ts`); `asOf` defaults to and is clamped at the release's `snapshot_date`.
- Each release snapshots its configuration (rule catalog with display strings, thresholds,
  model id, prompt and parser versions) and its eval result, so an old release renders as it
  shipped.

## Consequences

- Rewind is a filter, not a recomputation; past dates are stable within a release.
- The pointer flip is the deploy of data: code and data ship independently.
- Storage grows by one copy of derived rows per release (small: thousands of rows).
- `company_sources` (coverage facts) is not yet release-scoped; a second release should
  snapshot it (decision log #28).
