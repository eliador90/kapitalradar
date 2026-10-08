// Automatic confirmations from startupticker.ch financing news (TODOS, Remo 2026-10-07).
// An article confirms a company's round when it links the company by its exact legal name AND
// names it in the title (articles also link investors, which may be companies we track), and
// the company has a capital increase within the pre-registered window around the article date.
// One company + one increase in the window → accepted, high confidence ("Confirmed round");
// anything ambiguous → uncertain, low confidence ("possible confirmation").
import { addDays } from "../domain/dates";
import type { ConfirmationRow } from "./release";

export interface FinancingArticle {
  url: string;
  /** Article date (Europe/Zurich), ISO. */
  date: string;
  title: string;
  /** Companies the article links to, by legal name ("Soverli AG"). */
  companies: string[];
}

export interface CompanyForMatch {
  uid: string;
  /** Every legal name the company carried. */
  names: string[];
  /** Its capital increases (any date). */
  increases: { publicationId: string; publishedAt: string }[];
}

/** Same window as the pre-registered eval matching (announcement −120 / +180 days). */
export const MATCH_WINDOW = { before: 120, after: 180 } as const;

const LEGAL_SUFFIX = /\b(?:ag|sa|s\.a\.|gmbh|sarl|sàrl|sagl|ltd|inc|llc|plc|holding|in liquidation)\b/g;

/** Lower case, accents stripped, punctuation to spaces: "Sàrl" and "Sarl" compare equal. */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The distinctive part of a legal name: "Soverli AG" → "soverli". */
export function nameStem(name: string): string {
  return normalizeName(name).replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

const containsWords = (haystack: string, needle: string) => needle.length >= 3 && ` ${haystack} `.includes(` ${needle} `);

const AMOUNT =
  /(CHF|USD|EUR|GBP|US\$|\$|€|£)\s?(\d+(?:[.,]\d+)?)\s?(million|mio\.?|m|billion|bn)\b|(\d+(?:[.,]\d+)?)\s?(million|mio\.?|billion|bn)\s?(?:in\s+)?(CHF|francs|swiss francs|USD|dollars|EUR|euros)/i;
const CURRENCY: Record<string, string> = { chf: "CHF", francs: "CHF", "swiss francs": "CHF", usd: "USD", us$: "USD", $: "USD", dollars: "USD", eur: "EUR", "€": "EUR", euros: "EUR", gbp: "GBP", "£": "GBP" };

/** "Soverli raises CHF 3.5 million" → { amount: "3500000", currency: "CHF" }. */
export function statedAmountOf(title: string): { amount: string; currency: string } | null {
  const m = AMOUNT.exec(title);
  if (!m) return null;
  const [cur, num, unit] = m[1] ? [m[1], m[2]!, m[3]!] : [m[6]!, m[4]!, m[5]!];
  const currency = CURRENCY[cur.toLowerCase()];
  const value = Number(num.replace(",", "."));
  if (!currency || !Number.isFinite(value)) return null;
  const factor = /^b/i.test(unit) ? 1e9 : 1e6;
  return { amount: String(Math.round(value * factor)), currency };
}

const STAGE = /\b(pre-seed|seed|series [a-f]|bridge|growth)\b/i;
export const stageOf = (title: string) => STAGE.exec(title)?.[1]?.toLowerCase() ?? null;

// startupticker's financing category also carries news that is not an equity round. A
// "Confirmed round" must mean one, so these titles never confirm (audit 2026-10-08: 20 of 142
// high-confidence matches were acquisitions, grants, loans or listings).
/** Whole words, Unicode-aware (`\b` treats "è" as a boundary, so "lève" would never match). */
const words = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{N}])`, "iu");
/** Never a round: grants and prizes, loans, listings, liquidations. */
const NOT_A_ROUND = words("grants?|awards?|prizes?|preis|prix|loans?|prêts?|darlehen|kredit|crédit|ipo|spac|go(?:es|ing)? public|listing|börsengang|liquidation");
/** Acquisitions: a round only when the title also says money came in. */
const ACQUISITION = words("acqui\\p{L}*|übernimmt|übernahme|rachat|rachète|racheté|kauft|merger|majority|mehrheits\\p{L}*|majoritaire");
const RAISE = words("rais\\p{L}*|secur\\p{L}*|funding|financing|round|series [a-f]|seed|investors?|investment|finanzierung\\p{L}*|finanziert|kapitalerhöhung|levée|lève|financement|tour de table");

/** Whether a financing-news title can confirm an equity round. */
export const isRoundNews = (title: string) => !NOT_A_ROUND.test(title) && (!ACQUISITION.test(title) || RAISE.test(title));

export function matchConfirmations(articles: readonly FinancingArticle[], companies: readonly CompanyForMatch[]): ConfirmationRow[] {
  const byName = new Map<string, CompanyForMatch[]>();
  for (const c of companies) for (const n of new Set(c.names.map(normalizeName))) byName.set(n, [...(byName.get(n) ?? []), c]);
  const rows: ConfirmationRow[] = [];
  for (const a of articles) {
    if (!isRoundNews(a.title)) continue;
    const title = normalizeName(a.title);
    const linked = new Map<string, CompanyForMatch>();
    for (const n of a.companies) for (const c of byName.get(normalizeName(n)) ?? []) linked.set(c.uid, c);
    // The raiser is named in the title; investors and other mentions are not.
    const raisers = [...linked.values()].filter((c) => c.names.some((n) => containsWords(title, nameStem(n))));
    if (!raisers.length) continue;
    const stated = statedAmountOf(a.title);
    for (const c of raisers) {
      const from = addDays(a.date, -MATCH_WINDOW.before);
      const to = addDays(a.date, MATCH_WINDOW.after);
      const inWindow = c.increases.filter((i) => i.publishedAt >= from && i.publishedAt <= to);
      const nearest = [...inWindow].sort((x, y) => Math.abs(Date.parse(x.publishedAt) - Date.parse(a.date)) - Math.abs(Date.parse(y.publishedAt) - Date.parse(a.date)))[0];
      const unique = raisers.length === 1 && inWindow.length === 1;
      rows.push({
        companyUid: c.uid,
        sourceUrl: a.url,
        publishedAt: a.date,
        statedAmount: stated?.amount ?? null,
        statedCurrency: stated?.currency ?? null,
        stage: stageOf(a.title),
        matchMethod: "startupticker: linked legal name + title, increase within −120/+180 days",
        matchConfidence: unique ? "high" : "low",
        eventMatch: unique ? "accepted" : "uncertain",
        reviewedAt: null,
        matchedPublicationId: nearest?.publicationId ?? null,
      });
    }
  }
  return rows;
}
