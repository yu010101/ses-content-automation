import { config } from "../config.js";

export interface QiitaItemStats {
  id: string;
  title: string;
  url: string;
  likes_count: number;
  stocks_count: number;
  page_views_count: number;
  created_at: string;
  tags: string[];
}

export async function fetchQiitaStats(): Promise<QiitaItemStats[]> {
  const token = config.qiita.accessToken();
  const baseUrl = config.qiita.baseUrl;

  const items: QiitaItemStats[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await fetch(
      `${baseUrl}/authenticated_user/items?page=${page}&per_page=${perPage}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) {
      throw new Error(`Qiita API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as Array<{
      id: string;
      title: string;
      url: string;
      likes_count: number;
      stocks_count: number;
      page_views_count: number;
      created_at: string;
      tags: Array<{ name: string }>;
    }>;

    if (data.length === 0) break;

    for (const item of data) {
      items.push({
        id: item.id,
        title: item.title,
        url: item.url,
        likes_count: item.likes_count,
        stocks_count: item.stocks_count,
        page_views_count: item.page_views_count,
        created_at: item.created_at,
        tags: item.tags.map((t) => t.name),
      });
    }

    if (data.length < perPage) break;
    page++;
  }

  return items;
}

export function extractQiitaItemId(url: string): string | null {
  const match = url.match(/qiita\.com\/[^/]+\/items\/([a-f0-9]+)/);
  return match ? match[1] : null;
}
