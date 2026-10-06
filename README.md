# Kapitalradar

Swiss capital increases, classified with evidence from the official gazette.

Every Swiss AG that raises share capital publishes the change in the Swiss Official Gazette of
Commerce (SHAB). Kapitalradar reads those entries, rebuilds each company's capital history and
scores which increases look like a financing round. It serves the result as a dated record you
can rewind: the round is often in the gazette before the press release (spike: median 10.5
days earlier, 13 of 16 matched rounds).

Private preview. The live link, GIF and evaluation table land with release v1.

## Evaluation

The table below is generated from `eval/results/release-eval.json` when release v1 ships.

| System | Precision (n) | Recall on announced rounds |
|---|---|---|
| Rules + Claude | pending: verified precision sample | pending: cohort adjudication review |
| Rules only | pending | pending |

How it is measured: [methodology](app/methodology/page.tsx) ·
pre-registration in [`eval/preregistration/`](eval/preregistration/PREREGISTRATION.md) ·
decisions in [`docs/decision-log.md`](docs/decision-log.md).

## How it works

See [ARCHITECTURE.md](ARCHITECTURE.md) and the
[point-in-time release ADR](docs/adr/0001-point-in-time-release.md). In short: the SHAB REST
API feeds an immutable publication store, a parser with privacy-first clause classification
extracts capital steps, rules and `claude-opus-5-5` (run headless on a subscription, name-redacted
input, cached by input hash) score each increase, and a gated release build writes one dated,
immutable release that the app reads as of any date.

## Runbook

Prerequisites: Node 24, `.env.local` with `DATABASE_URL` (Neon), and for the app
`PREVIEW_PASSWORD` (≥ 20 random characters) and `PREVIEW_COOKIE_SECRET` (≥ 32).

```bash
npm ci
```

```bash
npm run ingest -- --start 2025-08-01
```

```bash
npm run history -- --run <run-key>
```

```bash
npm run classify -- backfill
```

```bash
npm run build-release -- --release r1 --dry-run
```

```bash
npm run eval -- run --release r1
```

```bash
npm run build-release -- --release r1
```

Rollback re-points to an earlier ready release:

```bash
npm run build-release -- --rollback r0
```

Checks: `npm run typecheck`, `npm test`, `npm run build`, and against a running server
`npm run leak-check -- --base http://localhost:3000`. CI never calls a model or the SHAB.

## Data and privacy

No natural-person data is committed: fixtures are scrubbed and checked against a private name
list (`npm run preregister -- check`). Excerpts are withheld until the gazette's reuse terms
are confirmed; every entry links to its SHAB publication. The dataset export
([data card](docs/DATA_CARD.md)) is built but not published for the same reason.

Not an official publication.
