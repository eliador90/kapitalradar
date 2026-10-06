# Kapitalradar design system

Source of truth for the UI tokens (design review DS2, D6). `app/globals.css` implements them;
change both together.

## Direction: the record is the signature

White paper, ink, hairline rules. No boxes, no shadows, no radius, no motion, no tracked
micro-labels. Red marks only the "Published by" boundary: the date control and the `asOf` cut
line. No Swiss cross, federal red or federal typography: the site must never pass for the SHAB.

## Colour tokens

| Token | Value | Contrast on paper | Use |
|---|---|---|---|
| `--paper` | `#FFFFFF` | — | page background |
| `--ink` | `#1A1A1A` | 17.4:1 | text, rules under table headers, focus ring, pips |
| `--ink-muted` | `#5E5A52` | 6.9:1 | secondary lines (canton · purpose, coverage) |
| `--rule` | `#D8D2C4` | never text | hairlines between rows and entries |
| `--time` | `#A61B1B` | 7.5:1 | "Published by" control and the `asOf` cut line; always paired with text |
| `--focus` | `#1A1A1A` | — | 2 px ring at 2 px offset |

Colour never encodes status: status is pips plus a label (DS1).

## Type

| Role | Face | Size / line |
|---|---|---|
| Body, UI | IBM Plex Sans 400/600 | 16/24 (16 px minimum for body) |
| Secondary lines | IBM Plex Sans 400 | 14/20 |
| Amounts, dates, SHAB numbers | IBM Plex Mono 400, `tabular-nums` | 15/24 |
| Page headline (one size) | Source Serif 4 400, upright, never italic | 32/40 |

Company names, legal forms and excerpts keep their original language with a `lang` attribute.

## Space and geometry

8 px grid. Max content width 1120 px; reading pages (/methodology, /misses) use a 72ch column.
Ledger rows ≥ 48 px; touch targets ≥ 44 × 44 px. 16 px side gutter on phones.

## Formats (DS3)

`CHF 132’231.38` (typographic apostrophe, cents dropped when zero) · `29 Sep 2026` ·
ranges `21–27 Sep 2026` · ISO dates in URLs · weeks Monday–Sunday. Helpers: `lib/domain/format.ts`.

## Status (DS1)

| State | Pips | Label |
|---|---|---|
| capital increased | ○○○ | Capital increased |
| abstain | ◐○○ | Capital increased · undecided |
| likely financing | ●●○ | Likely financing |
| confirmed | ●●● | Confirmed round |
| confirmed, missed | ●●● | Confirmed round · missed by classifier |
| possible confirmation | tier's pips | <tier label> · possible confirmation |
| not assessed | none | Not assessed |

Pips are `aria-hidden`; the label carries the meaning. Derivation: `lib/domain/status.ts`.

## Layout breakpoints (RA1)

- **≥ 1024 px:** Company | Status | Nominal share capital before → after | New shares | Announced round | SHAB published | Source.
- **640–1023 px:** new shares under the capital figure, the source link under the company name, the announced round under the status.
- **< 640 px:** two-line rows that keep table roles; the "Published by" bar is sticky; filters collapse into one `<details>`.
- No horizontal page scroll at 320 px or 200% zoom.
