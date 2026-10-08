# Kapitalradar design system

Source of truth for the UI tokens (design review DS2, D6). `app/globals.css` implements them;
change both together.

## Direction: a radar console over the record (redesign, 2026-10-08)

Blue-black scope glass, phosphor for the instrument, hairline grid, square corners, no shadows.
The record stays the substance: every visual (the timeline, later the map and the cap-table
chart) is an instrument reading the same release, and nothing draws data published after
`asOf`. Red marks only the "Published by" boundary: the timeline cursor, the date control and
the cut line. No Swiss cross, federal red or federal typography: the site must never pass for
the SHAB. Motion is decorative only and stops under `prefers-reduced-motion`.

## Colour tokens

| Token | Value | Contrast on paper | Use |
|---|---|---|---|
| `--paper` | `#070D12` | — | page background |
| `--panel` | `#0B141B` | — | instrument panels (timeline, feed) |
| `--grid` | `#142430` | never text | grid lines, row hairlines, meter track |
| `--rule` | `#213645` | never text | panel borders, rules under table headers |
| `--ink` | `#D5E0E5` | 14.5:1 | text |
| `--ink-muted` | `#8AA1AB` | 7.2:1 | secondary lines, axis labels |
| `--sweep` | `#4FE0C3` | 11.9:1 | the instrument: wordmark accent, live state, confirmed rounds, focus ring |
| `--likely` | `#FFB547` | 11.1:1 | likely financing |
| `--undecided` | `#A58BFF` | 7.2:1 | undecided (a different hue from amber, not a shade of it) |
| `--increased` | `#5F7C8B` | bars only | capital increased; recedes behind the two signal tones |
| `--time` | `#FF5B4F` | 6.4:1 | "Published by" cursor, control and cut line; always paired with text |

Colour reinforces status but never carries it alone: pips plus a label stay (DS1), and the
status legend under the timeline explains each tier with the release's own thresholds.

## Type

| Role | Face | Size / line |
|---|---|---|
| Body, UI | IBM Plex Sans 400/500/600 | 15/23 |
| Secondary lines | IBM Plex Sans 400 | 13.5/20 |
| Amounts, dates, SHAB numbers, metadata | IBM Plex Mono 400–600, `tabular-nums` | 14/22 |
| Wordmark, headings, tracked labels | IBM Plex Sans Condensed 600/700 | 26 / 30 / 11 caps |

Company names, legal forms and excerpts keep their original language with a `lang` attribute.

## Space and geometry

8 px grid. Max content width 1240 px; reading pages (/methodology, /misses) use a 72ch column.
Touch targets ≥ 40 px high. 16 px side gutter on phones; no horizontal page scroll at 375 px.

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
