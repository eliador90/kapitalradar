# Kapitalradar

Swiss capital increases, classified with evidence from the official gazette.

Every Swiss AG that raises share capital publishes the change in the Swiss Official Gazette of
Commerce (SHAB). Kapitalradar reads those entries, rebuilds each company's capital history and
scores which increases look like a financing round. It serves the result as a dated record you
can rewind: the round is often in the gazette before the press release (spike: median 10.5
days earlier, 13 of 16 matched rounds).

Private preview. The live link and GIF land with the public launch.

## Evaluation

Release v1 (`r2`, data as of 6 Oct 2026), evaluated 6 Oct 2026. Generated from
[`eval/results/release-eval.json`](eval/results/release-eval.json).

| System | Precision (n) | Recall on 30 announced rounds |
|---|---|---|
| Rules + Claude | 10–94 % estimate, 95 % interval 2–99 % (n=16) | 16/30 |
| Rules only | 10–93 % estimate, 95 % interval 3–99 % (n=29) | 18/30 |

Recall ceiling is 20/30: nine announced rounds have no capital increase in the gazette within
the pre-registered window, and one match stays uncertain. Precision is wide because 24 of 30 sampled increases have no public
evidence either way (4 verified, 2 refuted): most capital increases are never announced. Known
parser issues of this release are listed on the methodology page and fixed in v2.

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
