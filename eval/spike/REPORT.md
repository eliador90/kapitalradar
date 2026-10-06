# T2 data spike · 2026-10-05

Status: **signed off by Remo on 2026-10-06.** Match verdicts were Claude's
proposals, approved by Remo (eng V6); recorded in `matches.json`. Re-run: `npm run spike -- match | archive | band`.

## Go/no-go

| Check | Result | Rule | Decision |
|---|---|---|---|
| Retrieval: spike rounds with a gazette capital increase in −120/+180 d | **16/20 (80%)** | ≥ 60% proceed | **Go** (proceed as designed) |
| X1 claim: gazette-first startup increases verified as new financing | **1/10** verified, 9 unverifiable, 0 refuted (`eval/x1/evidence.json`) | ≥ 4/10 keeps "unannounced rounds" | **Reframe**: "capital-change explorer with financing likelihood" (same build, narrower launch claims) |
| E1 history: SHAB lookup by UID | works (`keyword=CHE-xxx.xxx.xxx` returns every rubric, HR01 included) | both UID routes fail → partial | **Go**, with partial history before 2019 |

## Findings

**Lag and order.** For the 16 proposed matches, the gazette entry precedes the announcement in
13 cases. Lag (gazette − announcement): median **−10.5 days**, range −83 to +61. The
announcement usually follows the register entry, because a round closes legally when the
capital increase is registered. This is the data-supported demo story: *the round is in the
official record before the press release* (gazette-first), not "rounds nobody announced".

**Misses (4).** Two registered long before the announcement, outside the −120 d window
(Plair −177 d, Sparkli −347 d after a stealth period); one has no increase since 2023
(Testmate: strategic investor "set to become" a shareholder); one was re-formed as a new AG in
March 2026 after the announcement (Aukera; financing likely in the predecessor GmbH).

**Archive depth.** The SHAB API serves publications from mid-2018; its keyword and UID index
starts in January 2019. 2016 is not reachable. Zefix's dated publication references reach
back to about 2017 (L.E.S.S.: references from 2017; founded 2012). Companies formed before
that get history "from <earliest publication found>" and age bucket **unknown** (rule weight
0, eng Q4). 4 of 20 spike companies had no HR01 in the index.

**Rate and latency.** 20 sequential searches at 500 ms spacing: median 510 ms, one outlier
13 s, no 429. Two scripts ran concurrently (≈4 req/s) for minutes without throttling. The
backfill's concurrency ≤ 4 with backoff stands.

**Capital band (Open Question 5).** Issuances under a band are published as their own HR02
entries ("Ordentliche Kapitalerhöhung innerhalb des Kapitalbandes" / "dans les limites de la
marge de fluctuation"). In a sample of 40 band-mentioning entries (Jun–Sep 2026), 17 carried
a capital increase, 23 were adoptions or amendments only. **Answer: yes, published separately.**

**Parsing notes for T4.** Structured XML carries `commonsNew/commonsActual` capital (nominal,
paid) and `legalForm` (0106 = AG); currencies other than CHF occur (EUR, USD); Italian
entries exist; set-off ("Verrechnung", "compensation de créances") appears both fully and
mixed with cash (ORamaVR, Agora Care); conditional-capital issuances (options) and
participation capital appear next to ordinary increases.

## Definitional flag (for the eval)

Axi Labs (spike rank 5): the announced strategic investment registered as a **set-off of a
USD 935k claim**. Under eng V1, set-off-only is `conversion_only`, not positive, so
announced investments made as a loan first and converted later count as misses for both
systems. Expect a few in the recall cohort; they belong in the misses page with this reason.

## Matches (adjudicated)

`eval/spike/matches.json` holds the candidates and the `adjudication` per round. Accepted for
ranks 1, 3, 5, 7, 9, 12, 13, 19, 25, 27, 28, 29, 31, 32, 33, 35.
