# Architecture

Kapitalradar reads capital increases of Swiss AGs from the Swiss Official Gazette of Commerce
(SHAB), rebuilds each company's capital history, scores which increases look like financing
rounds, and serves the result as a dated, point-in-time record.

```
 SHAB REST API ──► ingest ──► publications (raw XML, immutable)
 Zefix refs   ──► history ──► company_sources (coverage facts per company)
                                │
                                ▼
            parse ─► fold (capital context, no lookahead) ─► rules ─► classifier
                                │                                      (claude -p, cached
                                ▼                                       by input hash)
                     build-release ──► events · company_names · assessments · confirmations
                                │        (every row carries release_id)
                     gates pass? ──► current_release pointer flips (one transaction)
                                │
                                ▼
            app/ (Next.js) ─► lib/data/readers ─► release_id = current AND published_at ≤ asOf
```

## Layers

| Path | Role |
|---|---|
| `lib/domain/` | Pure rules and formats: as-of resolution, weeks, status derivation, rule catalog, share issuance, metrics, Swiss formatting. No I/O. |
| `lib/pipeline/` | Fetching (rate-limited `politeFetch`), XML parsing with privacy-first clause classification, history refresh, capital fold, rules, name redaction, classifier backend, release build and gates. |
| `lib/data/` | Server data readers for the app. Each calls `assertPreviewAccess()` first and filters by release and asOf. |
| `lib/preview-gate.ts` | HMAC cookie gate for the private preview; `proxy.ts` redirects early, the readers enforce. |
| `db/` | Drizzle schema, migrations, the shared `visibleAt` predicate. |
| `scripts/` | Operator commands: ingest, history, classify, build-release, eval, leak-check. |
| `eval/` | Pre-registration, sealed recall cohort, inspected-company ledger, dev labels, fixtures, eval artifacts. Isolated from production code (a test enforces it). |
| `app/` | Feed, company record, methodology, misses, preview gate, 404 and error states. |

## Invariants

- **One release per request.** `getRelease()` (React `cache()`) resolves `current_release`
  once; every reader receives that release id. Pages are dynamic; nothing is page-cached.
- **As-of is inclusive and clamped.** A row is visible iff `published_at ≤ asOf`. `asOf`
  defaults to the release snapshot and is clamped to `[backfill start, snapshot]`.
  Cancellations hide their target from the cancellation's own date. Release-level chrome
  (eval line, curated rewind link, release id) is the only content that does not rewind.
- **Unknown and not-yet-published UIDs are indistinguishable** (same 404, same body).
- **Status is derived in one place** (`lib/domain/status.ts`); a confirmed tier is never stored.
- **No natural-person data in committed files.** The parser masks person clauses; committed
  fixtures are scrubbed and checked against a private name list.
- **CI never calls a model or the SHAB.** Classifications are cached by
  `(input hash, model id, prompt version)`; a release reads only cached rows.
- **Releases are immutable.** A build writes a new release id; the pointer flips only after the
  gates pass (parse and classifier error ≤ 5 %, no gazette weekday without HR02 entries, evidence
  spans inside their text, eval results present). Rollback re-points to an earlier ready release.

## Classifier

`claude-opus-5-5` at low effort, run headless through `claude -p` with an isolated
`CLAUDE_CONFIG_DIR`, no tools, a JSON schema and the system prompt in `prompts/`. Input is the
rule facts plus name-redacted company text. Thresholds τ (likely financing) and τ_low
(undecided) were frozen on dev data before the evaluation sets were opened
(`config/classification.json`).

## Checks

- `npm test`: domain, parser, pipeline, release isolation, gate routes, eval isolation.
- `npm run leak-check`: fetches whole responses (HTML and RSC payload) from a running server
  at rewind dates and fails on any later publication number, date or name; positive controls
  keep it from passing vacuously.
- Decisions taken during the build: `docs/decision-log.md`. Design tokens: `DESIGN.md`.
