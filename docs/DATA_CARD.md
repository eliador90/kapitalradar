# Data card: Kapitalradar dataset

Status: **built, not published.** `npm run export -- --release rN` writes the CSV and a
release-specific card to `.data/export/` after a blocking person-data gate. Nothing is hosted
until the SHAB reuse terms are confirmed (Open Question 1).

| Column | Meaning |
|---|---|
| `uid` | Swiss enterprise identification number, canonical `CHE#########` |
| `company_name` | Name as of the release snapshot |
| `canton`, `legal_form` | As published in the entry (`0106` AG, `0107` GmbH) |
| `legal_date` | Statute-change date from the text, else the journal date |
| `published_at` | SHAB publication date (the as-of key) |
| `shab_publication_number`, `shab_url` | The source entry |
| `currency`, `nominal_capital_before`, `nominal_capital_after` | Nominal share capital, decimal strings |
| `shares_before`, `shares_after` | Total shares across classes, when published or chained from history |
| `tier` | `likely_financing`, `abstain` (undecided), `capital_increased`, or `not_assessed` (history before the window, reductions) |
| `model_id`, `prompt_version` | Classifier identity for assessed rows |

Excluded: gazette text (including the purpose), person data, evaluation labels (dev or
holdout), and confirmations: the site's "Confirmed round" status is matched automatically from
startupticker.ch financing news (see the methodology) and is not part of the export. Scores are not calibrated probabilities. Coverage: AG capital changes published from
the release's backfill start to its snapshot, plus each such company's earlier publications.
