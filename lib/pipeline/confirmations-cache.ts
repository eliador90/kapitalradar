// The startupticker article cache shared by the crawler (scripts/confirmations.ts) and the
// release build. Not committed: it lives in .data/ locally and in the Actions cache in CI.
import { existsSync, readFileSync } from "node:fs";
import type { FinancingArticle } from "./confirmations";

export const ARTICLE_CACHE = ".data/startupticker/financing-articles.json";

export type ArticleCache = Record<string, Omit<FinancingArticle, "url">>;

export function readArticleCache(path = ARTICLE_CACHE): ArticleCache {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ArticleCache) : {};
}

export const articlesOf = (cache: ArticleCache): FinancingArticle[] => Object.entries(cache).map(([url, a]) => ({ url, ...a }));
