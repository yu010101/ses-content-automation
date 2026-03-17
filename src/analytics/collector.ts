import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchQiitaStats, extractQiitaItemId } from "./qiita-stats.js";
import { fetchZennStats, extractZennSlug } from "./zenn-stats.js";
import type { QiitaItemStats } from "./qiita-stats.js";
import type { ZennArticleStats } from "./zenn-stats.js";

export interface ArticlePerformance {
  title: string;
  publishedDate: string;
  platforms: {
    qiita?: {
      id: string;
      url: string;
      views: number;
      likes: number;
      stocks: number;
      tags: string[];
    };
    zenn?: {
      slug: string;
      url: string;
      likes: number;
      topics: string[];
    };
    note?: {
      url: string;
    };
  };
  totalEngagement: number;
}

export interface PerformanceSnapshot {
  collectedAt: string;
  articles: ArticlePerformance[];
  summary: {
    totalArticles: number;
    totalViews: number;
    totalLikes: number;
    totalStocks: number;
    avgViewsPerArticle: number;
    avgLikesPerArticle: number;
    topPerformer: string | null;
  };
}

interface PublishedRecord {
  articles: Array<{
    title: string;
    date: string;
    articleId?: string;
    platforms: Array<{
      platform: string;
      success: boolean;
      url?: string;
      error?: string;
    }>;
  }>;
}

export async function collectPerformanceData(): Promise<PerformanceSnapshot> {
  const publishedPath = join(process.cwd(), "data/published.json");
  let published: PublishedRecord;
  try {
    published = JSON.parse(readFileSync(publishedPath, "utf-8"));
  } catch {
    published = { articles: [] };
  }

  // Fetch stats from both platforms
  let qiitaStats: QiitaItemStats[] = [];
  let zennStats: ZennArticleStats[] = [];

  try {
    console.log("  Fetching Qiita stats...");
    qiitaStats = await fetchQiitaStats();
    console.log(`  Qiita: ${qiitaStats.length} articles found`);
  } catch (err) {
    console.log(`  Qiita stats unavailable: ${err instanceof Error ? err.message : err}`);
  }

  try {
    console.log("  Fetching Zenn stats...");
    zennStats = await fetchZennStats();
    console.log(`  Zenn: ${zennStats.length} articles found`);
  } catch (err) {
    console.log(`  Zenn stats unavailable: ${err instanceof Error ? err.message : err}`);
  }

  // Build lookup maps
  const qiitaById = new Map<string, QiitaItemStats>();
  const qiitaByTitle = new Map<string, QiitaItemStats>();
  for (const item of qiitaStats) {
    qiitaById.set(item.id, item);
    qiitaByTitle.set(item.title.toLowerCase(), item);
  }

  const zennBySlug = new Map<string, ZennArticleStats>();
  const zennByTitle = new Map<string, ZennArticleStats>();
  const zennByDate = new Map<string, ZennArticleStats>();
  for (const item of zennStats) {
    zennBySlug.set(item.slug, item);
    zennByTitle.set(item.title.toLowerCase(), item);
    // Index by date (YYYYMMDD) for fuzzy matching when titles differ
    const dateMatch = item.slug.match(/^(\d{8})/);
    if (dateMatch) {
      zennByDate.set(dateMatch[1], item);
    }
  }

  // Match published articles with platform stats
  const articles: ArticlePerformance[] = [];
  const matchedZennSlugs = new Set<string>();

  for (const pub of published.articles) {
    const perf: ArticlePerformance = {
      title: pub.title,
      publishedDate: pub.date,
      platforms: {},
      totalEngagement: 0,
    };

    // Match Qiita
    const qiitaPlatform = pub.platforms.find(
      (p) => p.platform === "qiita" && p.success && p.url,
    );
    if (qiitaPlatform?.url) {
      const itemId = extractQiitaItemId(qiitaPlatform.url);
      const qItem = itemId
        ? qiitaById.get(itemId)
        : qiitaByTitle.get(pub.title.toLowerCase());
      if (qItem) {
        perf.platforms.qiita = {
          id: qItem.id,
          url: qItem.url,
          views: qItem.page_views_count,
          likes: qItem.likes_count,
          stocks: qItem.stocks_count,
          tags: qItem.tags,
        };
        perf.totalEngagement += qItem.page_views_count + qItem.likes_count * 10 + qItem.stocks_count * 5;
      }
    }

    // Match Zenn
    const zennPlatform = pub.platforms.find(
      (p) => p.platform === "zenn" && p.success && p.url,
    );
    if (zennPlatform?.url) {
      const slug = extractZennSlug(zennPlatform.url);
      // Try: exact slug → title match → date-based fuzzy match (avoiding duplicates)
      let zItem = (slug ? zennBySlug.get(slug) : null)
        ?? zennByTitle.get(pub.title.toLowerCase())
        ?? null;
      if (!zItem) {
        // Fuzzy: match by published date, but only if not already matched
        const pubDate = pub.date.slice(0, 10).replace(/-/g, "");
        const candidate = zennByDate.get(pubDate);
        if (candidate && !matchedZennSlugs.has(candidate.slug)) {
          zItem = candidate;
        }
      }
      if (zItem && !matchedZennSlugs.has(zItem.slug)) {
        matchedZennSlugs.add(zItem.slug);
        perf.platforms.zenn = {
          slug: zItem.slug,
          url: zItem.url,
          likes: zItem.liked_count,
          topics: zItem.topics,
        };
        perf.totalEngagement += zItem.liked_count * 10;
      }
    }

    // Match Note (no API stats, just URL presence)
    const notePlatform = pub.platforms.find(
      (p) => p.platform === "note" && p.success && p.url && p.url.startsWith("https://"),
    );
    if (notePlatform?.url) {
      perf.platforms.note = { url: notePlatform.url };
    }

    articles.push(perf);
  }

  // Also include Qiita/Zenn articles not in published.json
  for (const qItem of qiitaStats) {
    const alreadyMatched = articles.some(
      (a) => a.platforms.qiita?.id === qItem.id,
    );
    if (!alreadyMatched) {
      articles.push({
        title: qItem.title,
        publishedDate: qItem.created_at,
        platforms: {
          qiita: {
            id: qItem.id,
            url: qItem.url,
            views: qItem.page_views_count,
            likes: qItem.likes_count,
            stocks: qItem.stocks_count,
            tags: qItem.tags,
          },
        },
        totalEngagement:
          qItem.page_views_count + qItem.likes_count * 10 + qItem.stocks_count * 5,
      });
    }
  }

  // Calculate summary
  let totalViews = 0;
  let totalLikes = 0;
  let totalStocks = 0;
  let topPerformer: string | null = null;
  let topEngagement = 0;

  for (const a of articles) {
    if (a.platforms.qiita) {
      totalViews += a.platforms.qiita.views;
      totalLikes += a.platforms.qiita.likes;
      totalStocks += a.platforms.qiita.stocks;
    }
    if (a.platforms.zenn) {
      totalLikes += a.platforms.zenn.likes;
    }
    if (a.totalEngagement > topEngagement) {
      topEngagement = a.totalEngagement;
      topPerformer = a.title;
    }
  }

  const snapshot: PerformanceSnapshot = {
    collectedAt: new Date().toISOString(),
    articles: articles.sort((a, b) => b.totalEngagement - a.totalEngagement),
    summary: {
      totalArticles: articles.length,
      totalViews,
      totalLikes,
      totalStocks,
      avgViewsPerArticle: articles.length > 0 ? Math.round(totalViews / articles.length) : 0,
      avgLikesPerArticle: articles.length > 0 ? Math.round(totalLikes / articles.length) : 0,
      topPerformer,
    },
  };

  // Save snapshot
  const perfPath = join(process.cwd(), "data/performance.json");
  writeFileSync(perfPath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`  Performance data saved to ${perfPath}`);

  return snapshot;
}

export function displayPerformanceRanking(snapshot: PerformanceSnapshot): void {
  console.log("\n=== Article Performance Ranking ===\n");
  console.log(`Collected: ${snapshot.collectedAt}`);
  console.log(`Total Articles: ${snapshot.summary.totalArticles}`);
  console.log(`Total Views: ${snapshot.summary.totalViews}`);
  console.log(`Total Likes: ${snapshot.summary.totalLikes}`);
  console.log(`Total Stocks: ${snapshot.summary.totalStocks}`);
  console.log(`Avg Views/Article: ${snapshot.summary.avgViewsPerArticle}`);
  console.log("");

  for (let i = 0; i < snapshot.articles.length; i++) {
    const a = snapshot.articles[i];
    const rank = i + 1;
    const q = a.platforms.qiita;
    const z = a.platforms.zenn;

    console.log(`#${rank} ${a.title}`);
    console.log(`   Engagement Score: ${a.totalEngagement}`);
    if (q) {
      console.log(`   Qiita: ${q.views} views, ${q.likes} likes, ${q.stocks} stocks`);
    }
    if (z) {
      console.log(`   Zenn: ${z.likes} likes`);
    }
    if (a.platforms.note) {
      console.log(`   Note: ${a.platforms.note.url}`);
    }
    console.log("");
  }
}
