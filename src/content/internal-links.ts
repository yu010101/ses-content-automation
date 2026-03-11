import { readFileSync } from "node:fs";
import { join } from "node:path";

interface PublishedArticle {
  title: string;
  date: string;
  platforms: Array<{ platform: string; success: boolean; url?: string }>;
}

interface PublishedRecord {
  articles: PublishedArticle[];
}

interface RelatedLink {
  title: string;
  url: string;
  platform: string;
}

function loadPublished(): PublishedArticle[] {
  try {
    const data: PublishedRecord = JSON.parse(
      readFileSync(join(process.cwd(), "data/published.json"), "utf-8"),
    );
    return data.articles;
  } catch {
    return [];
  }
}

/**
 * Get related article links from published history.
 * Returns up to 3 Qiita links (most SEO-valuable for internal linking).
 */
export function getRelatedLinks(
  currentTitle: string,
  maxLinks = 3,
): RelatedLink[] {
  const articles = loadPublished();
  const links: RelatedLink[] = [];

  for (const article of articles.reverse()) {
    // Skip current article
    if (article.title === currentTitle) continue;

    // Prefer Qiita URLs (public, indexable)
    const qiita = article.platforms.find(
      (p) => p.platform === "qiita" && p.success && p.url && !p.url.includes("dry-run"),
    );
    if (qiita?.url) {
      links.push({ title: article.title, url: qiita.url, platform: "qiita" });
    }

    if (links.length >= maxLinks) break;
  }

  return links;
}

/**
 * Insert a "related articles" section before the CTA in the article body.
 */
export function insertRelatedLinks(body: string, currentTitle: string): string {
  const links = getRelatedLinks(currentTitle);
  if (links.length === 0) return body;

  const section = `
## 関連記事

${links.map((l) => `- [${l.title}](${l.url})`).join("\n")}
`;

  // Insert before CTA separator (---)
  const ctaIndex = body.lastIndexOf("\n---\n");
  if (ctaIndex > 0) {
    return body.slice(0, ctaIndex) + "\n" + section + body.slice(ctaIndex);
  }

  // Fallback: append before last section
  return body + "\n" + section;
}
