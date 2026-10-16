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
      views: number | null;
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
  /** Deprecated: platform metrics are not combined. */
  totalEngagement: null;
}

export interface PerformanceSnapshot {
  collectedAt: string;
  collection?: { qiita: "ok" | "unavailable"; zenn: "ok" | "unavailable" };
  articles: ArticlePerformance[];
  summary: {
    recordCount: number;
    totalViews: number | null;
    totalLikes: null;
    totalStocks: number | null;
    avgViewsPerArticle: number | null;
    avgLikesPerArticle: number | null;
    topPerformer: string | null;
    platforms: {
      qiita: { articles: number; measuredViews: number; views: number | null; likes: number | null; stocks: number | null };
      zenn: { articles: number; likes: number | null };
      note: { urlRecords: number; likes: null };
    };
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
  let qiitaFetched = false, zennFetched = false;
  let qiitaStats: QiitaItemStats[] = [];
  let zennStats: ZennArticleStats[] = [];

  try {
    console.log("  Fetching Qiita stats...");
    qiitaStats = await fetchQiitaStats();
    qiitaFetched = true;
    console.log(`  Qiita: ${qiitaStats.length} articles found`);
  } catch (err) {
    console.log(`  Qiita stats unavailable: ${err instanceof Error ? err.message : err}`);
  }

  try {
    console.log("  Fetching Zenn stats...");
    zennStats = await fetchZennStats();
    zennFetched = true;
    console.log(`  Zenn: ${zennStats.length} articles found`);
  } catch (err) {
    console.log(`  Zenn stats unavailable: ${err instanceof Error ? err.message : err}`);
  }

  if (!qiitaFetched && !zennFetched) throw new Error("No platform metrics fetched; previous snapshot preserved");

  // Build lookup maps
  const qiitaById = new Map<string, QiitaItemStats>();
  
  for (const item of qiitaStats) {
    qiitaById.set(item.id, item);

  }

  const zennBySlug = new Map<string, ZennArticleStats>();
  for (const item of zennStats) zennBySlug.set(item.slug, item);

  // Match published articles with platform stats
  const articles: ArticlePerformance[] = [];
  const matchedZennSlugs = new Set<string>();
  const matchedQiitaIds = new Set<string>();

  for (const pub of published.articles) {
    const perf: ArticlePerformance = {
      title: pub.title,
      publishedDate: pub.date,
      platforms: {},
      totalEngagement: null,
    };

    // Match Qiita
    const qiitaPlatform = pub.platforms.find(
      (p) => p.platform === "qiita" && p.success && p.url,
    );
    if (qiitaPlatform?.url) {
      const itemId = extractQiitaItemId(qiitaPlatform.url);
      const qItem = itemId ? qiitaById.get(itemId) : undefined;
      if (qItem && !matchedQiitaIds.has(qItem.id)) {
        matchedQiitaIds.add(qItem.id);
        perf.platforms.qiita = {
          id: qItem.id,
          url: qItem.url,
          views: Number.isFinite(qItem.page_views_count) && qItem.page_views_count >= 0 ? qItem.page_views_count : null,
          likes: qItem.likes_count,
          stocks: qItem.stocks_count,
          tags: qItem.tags,
        };

      }
    }

    // Match Zenn
    const zennPlatform = pub.platforms.find(
      (p) => p.platform === "zenn" && p.success && p.url,
    );
    if (zennPlatform?.url) {
      const slug = extractZennSlug(zennPlatform.url);
      const zItem = slug ? zennBySlug.get(slug) : undefined;
      if (zItem && !matchedZennSlugs.has(zItem.slug)) {
        matchedZennSlugs.add(zItem.slug);
        perf.platforms.zenn = {
          slug: zItem.slug,
          url: zItem.url,
          likes: zItem.liked_count,
          topics: zItem.topics,
        };

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
            views: Number.isFinite(qItem.page_views_count) && qItem.page_views_count >= 0 ? qItem.page_views_count : null,
            likes: qItem.likes_count,
            stocks: qItem.stocks_count,
            tags: qItem.tags,
          },
        },
        totalEngagement: null,
      });
    }
  }

  // Retain observed Zenn articles even when the publishing ledger is incomplete.
  for (const item of zennStats) {
    if (!articles.some(a => a.platforms.zenn?.slug === item.slug)) {
      articles.push({ title: item.title, publishedDate: item.published_at,
        platforms: { zenn: { slug: item.slug, url: item.url, likes: item.liked_count, topics: item.topics } },
        totalEngagement: null });
    }
  }
  const qiita = articles.flatMap(a => a.platforms.qiita ? [a.platforms.qiita] : []);
  const zenn = articles.flatMap(a => a.platforms.zenn ? [a.platforms.zenn] : []);
  const measuredViews = qiita.filter(q => q.views !== null);
  const totalViews = measuredViews.length ? measuredViews.reduce((n,q) => n + q.views!,0) : null;
  const totalStocks = qiita.length ? qiita.reduce((n,q) => n + q.stocks,0) : null;

  const snapshot: PerformanceSnapshot = {
    collectedAt: new Date().toISOString(),
    collection: { qiita: qiitaFetched ? "ok" : "unavailable", zenn: zennFetched ? "ok" : "unavailable" },
    articles,
    summary: {
      recordCount: articles.length,
      totalViews,
      totalLikes: null,
      totalStocks,
      avgViewsPerArticle: totalViews === null ? null : Math.round(totalViews / measuredViews.length),
      // Cross-platform averages are intentionally disabled; retained for legacy readers.
      avgLikesPerArticle: null,
      topPerformer: null,
      platforms: {
        qiita: { articles: qiita.length, measuredViews: measuredViews.length, views: totalViews, likes: qiita.length ? qiita.reduce((n,q)=>n+q.likes,0) : null, stocks: totalStocks },
        zenn: { articles: zenn.length, likes: zenn.length ? zenn.reduce((n,z)=>n+z.likes,0) : null },
        note: { urlRecords: articles.filter(a=>a.platforms.note).length, likes: null },
      },
    },
  };

  // Save snapshot
  const perfPath = join(process.cwd(), "data/performance.json");
  writeFileSync(perfPath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`  Performance data saved to ${perfPath}`);

  return snapshot;
}

export function displayPerformanceRanking(snapshot: PerformanceSnapshot): void {
  console.log("\n=== Platform observations (not ranked) ===\n");
  console.log(`Collected: ${snapshot.collectedAt}`);
  console.log(`Ledger/observed records: ${snapshot.summary.recordCount}`);
  console.log(`Measured Qiita views subtotal (${snapshot.summary.platforms.qiita.measuredViews}/${snapshot.summary.platforms.qiita.articles} records): ${snapshot.summary.totalViews ?? "unmeasured"}`);
  console.log(`Qiita likes: ${snapshot.summary.platforms.qiita.likes ?? "unmeasured"}; Zenn likes: ${snapshot.summary.platforms.zenn.likes ?? "unmeasured"}`);
  console.log(`Total Stocks: ${snapshot.summary.totalStocks}`);
  console.log(`Avg Qiita views/measured article: ${snapshot.summary.avgViewsPerArticle}`);
  console.log("");

  for (let i = 0; i < snapshot.articles.length; i++) {
    const a = snapshot.articles[i];
    const rank = i + 1;
    const q = a.platforms.qiita;
    const z = a.platforms.zenn;

    console.log(`#${rank} ${a.title}`);
    console.log("   Combined score: not computed");
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
