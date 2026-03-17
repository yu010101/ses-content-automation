import { config } from "../config.js";

export interface ZennArticleStats {
  slug: string;
  title: string;
  url: string;
  liked_count: number;
  published_at: string;
  article_type: string;
  topics: string[];
}

export async function fetchZennStats(): Promise<ZennArticleStats[]> {
  const username = config.zenn.user;
  const articles: ZennArticleStats[] = [];
  let nextPage: string | null = null;

  while (true) {
    const url = nextPage
      ? `https://zenn.dev/api/articles?username=${username}&order=latest&next=${nextPage}`
      : `https://zenn.dev/api/articles?username=${username}&order=latest`;

    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`Zenn API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as {
      articles: Array<{
        slug: string;
        title: string;
        liked_count: number;
        published_at: string;
        article_type: string;
        topics?: Array<{ name: string }>;
      }>;
      next_page: string | null;
    };

    for (const item of data.articles) {
      articles.push({
        slug: item.slug,
        title: item.title,
        url: `https://zenn.dev/${username}/articles/${item.slug}`,
        liked_count: item.liked_count,
        published_at: item.published_at,
        article_type: item.article_type,
        topics: item.topics?.map((t) => t.name) ?? [],
      });
    }

    if (!data.next_page) break;
    nextPage = data.next_page;
  }

  return articles;
}

export function extractZennSlug(url: string): string | null {
  // Match both formats:
  //   https://zenn.dev/ailmarketing/articles/20260317-ai---ai (with username)
  //   https://zenn.dev/articles/20260311-ses (without username, legacy)
  const match = url.match(/zenn\.dev\/(?:[^/]+\/)?articles\/([a-z0-9-]+)/);
  return match ? match[1] : null;
}
