// startupticker.ch, used only to hand-build the eval ground truth (Open Question 4 gates any
// production use). robots.txt asks for a 5 s crawl delay.
import { fetchText } from "../../lib/pipeline/http";

export const BASE = "https://www.startupticker.ch";
const CRAWL_DELAY_MS = 5000;

export interface ListItem {
  /** ISO date of the article (list date, Europe/Zurich). */
  date: string;
  title: string;
  url: string;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const stripTags = (s: string) =>
  decode(s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

export function parseFinancingList(html: string): ListItem[] {
  // Some items link via /index.php/en/news/…; canonicalize to /en/news/….
  const re =
    /class="date">(\d{2})\.(\d{2})\.(\d{4})[^<]*<\/div>\s*<a href="(?:\/index\.php)?(\/en\/news\/[^"]+)"><h2>([\s\S]*?)<\/h2>/g;
  const items: ListItem[] = [];
  for (const m of html.matchAll(re)) {
    items.push({ date: `${m[3]}-${m[2]}-${m[1]}`, url: BASE + m[4], title: stripTags(m[5]!) });
  }
  return items;
}

export async function fetchFinancingPage(page: number): Promise<ListItem[]> {
  const url = `${BASE}/en/topics?page=${page}&category=Financing`;
  const html = await fetchText(url, { minIntervalMs: CRAWL_DELAY_MS });
  const items = parseFinancingList(html);
  const listed = html.match(/class="date">/g)?.length ?? 0;
  if (items.length === 0 || items.length !== listed) {
    throw new Error(`parsed ${items.length} of ${listed} list items from ${url}: layout changed?`);
  }
  return items;
}

export interface Article {
  title: string;
  body: string;
  /** Companies the article links to on startupticker, e.g. "Bee People AG". */
  companies: string[];
}

export function parseArticle(html: string): Article {
  const title = stripTags(html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? "");
  const start = html.indexOf("</h1>");
  const end = html.indexOf('class="link-login"', start);
  if (start < 0 || end < 0) throw new Error("article body markers not found: layout changed?");
  const body = stripTags(html.slice(start + 5, html.lastIndexOf("<", end)).replace(/<div class="category[\s\S]*?<\/div>/g, ""));
  const companies = [
    ...new Set([...html.matchAll(/href="\/en\/companies\/[^"]+">([^<]+)<\/a>/g)].map((m) => decode(m[1]!).trim())),
  ];
  return { title, body, companies };
}

export async function fetchArticle(url: string): Promise<Article> {
  return parseArticle(await fetchText(url, { minIntervalMs: CRAWL_DELAY_MS }));
}
