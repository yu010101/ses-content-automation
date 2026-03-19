import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverTrends } from "./trends/grok.js";
import { fetchMarketData, formatMarketContext } from "./trends/market-data.js";
import {
  generateArticle,
  generateNoteVariation,
  generateZennVariation,
  generateQiitaVariation,
} from "./content/generator.js";
import { insertRelatedLinks } from "./content/internal-links.js";
import { QiitaPublisher } from "./publishers/qiita.js";
import { ZennPublisher } from "./publishers/zenn.js";
import { XPublisher } from "./publishers/x.js";
import { NotePublisher } from "./publishers/note.js";
import { loadLearningState, formatLearningContext } from "./analytics/feedback.js";
import { extractQiitaItemId } from "./analytics/qiita-stats.js";
import { extractZennSlug } from "./analytics/zenn-stats.js";
import type { PublishResult } from "./publishers/types.js";
import type { GeneratedArticle } from "./content/generator.js";

type Platform = "qiita" | "zenn" | "x" | "note";

interface PublishedRecord {
  articles: Array<{
    title: string;
    date: string;
    articleId?: string;
    platforms: PublishResult[];
  }>;
}

function loadPublished(): PublishedRecord {
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), "data/published.json"), "utf-8"),
    );
  } catch {
    return { articles: [] };
  }
}

function loadKeywords(): string[] {
  const data = JSON.parse(
    readFileSync(join(process.cwd(), "data/keywords.json"), "utf-8"),
  );
  const highCv: string[] = data.high_conversion ?? [];
  const rest: string[] = [...data.primary, ...data.secondary];
  const angleSeedsAll: string[] = data.angle_seeds ?? [];

  const shuffle = (arr: string[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  shuffle(angleSeedsAll);
  const angleSeeds = angleSeedsAll.slice(0, 2);

  const learning = loadLearningState();
  if (learning && learning.bestKeywords.length > 0) {
    const bestKw = [...learning.bestKeywords];
    shuffle(bestKw);
    shuffle(highCv);
    shuffle(rest);
    const proven = bestKw.slice(0, 3);
    const exploratory = [...highCv.slice(0, 2), ...rest.slice(0, 3)];
    return [...proven, ...exploratory, ...angleSeeds];
  }

  shuffle(highCv);
  shuffle(rest);
  return [...highCv.slice(0, 3), ...rest.slice(0, 5), ...angleSeeds];
}

function recordResult(title: string, result: PublishResult) {
  const filePath = join(process.cwd(), "data/published.json");
  const data = loadPublished();

  const qiitaItemId =
    result.platform === "qiita" && result.success && result.url
      ? extractQiitaItemId(result.url)
      : null;
  const zennSlug =
    result.platform === "zenn" && result.success && result.url
      ? extractZennSlug(result.url)
      : null;
  const articleId = qiitaItemId || zennSlug || undefined;

  data.articles.push({
    title,
    date: new Date().toISOString(),
    articleId,
    platforms: [result],
  });
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function publishSinglePlatform(
  platform: Platform,
  options: { dryRun?: boolean } = {},
) {
  const { dryRun = false } = options;

  console.log(`=== Single Platform Publish: ${platform} ===`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}\n`);

  // Step 1: Discover trends
  console.log("[1/4] Discovering trends via Grok...");
  let trends: Awaited<ReturnType<typeof discoverTrends>> = [];
  try {
    trends = await discoverTrends();
    console.log(`Found ${trends.length} trends`);
  } catch (err) {
    console.log(
      `  Grok API unavailable (${err instanceof Error ? err.message : err})`,
    );
    console.log("  Falling back to keyword-only article generation.");
  }

  // Fetch market data
  let marketContext = "";
  try {
    const marketData = await fetchMarketData();
    marketContext = formatMarketContext(marketData);
  } catch (err) {
    console.log(
      `  Market data unavailable (${err instanceof Error ? err.message : err})`,
    );
  }

  // Step 2: Generate article
  console.log("\n[2/4] Generating article via Claude...");
  const keywords = loadKeywords();

  let learningContext = "";
  const learningState = loadLearningState();
  if (learningState) {
    learningContext = formatLearningContext(learningState);
    console.log(`  Learning state loaded (updated: ${learningState.lastUpdated})`);
  }

  const baseArticle: GeneratedArticle = await generateArticle(
    trends,
    keywords,
    marketContext,
    learningContext,
  );
  console.log(`Title: ${baseArticle.title}`);
  console.log(`Length: ${baseArticle.body.length} chars`);

  // Insert internal links
  baseArticle.body = insertRelatedLinks(baseArticle.body, baseArticle.title);

  // Step 3: Generate platform-specific variation and publish
  console.log(`\n[3/4] Preparing ${platform}-specific content...`);
  let article: GeneratedArticle = baseArticle;
  let result: PublishResult;

  switch (platform) {
    case "qiita": {
      try {
        article = await generateQiitaVariation(baseArticle);
        console.log(`Qiita variation: ${article.body.length} chars`);
      } catch (err) {
        console.log(
          `  Qiita variation failed (${err instanceof Error ? err.message : err}), using base`,
        );
      }
      const publisher = new QiitaPublisher();
      result = await publisher.publish(article, dryRun);
      break;
    }

    case "zenn": {
      try {
        article = await generateZennVariation(baseArticle);
        console.log(`Zenn variation: ${article.body.length} chars`);
      } catch (err) {
        console.log(
          `  Zenn variation failed (${err instanceof Error ? err.message : err}), using base`,
        );
      }
      const publisher = new ZennPublisher();
      result = await publisher.publish(article, dryRun);
      break;
    }

    case "note": {
      try {
        article = await generateNoteVariation(baseArticle);
        console.log(`Note variation: ${article.body.length} chars`);
      } catch (err) {
        console.log(
          `  Note variation failed (${err instanceof Error ? err.message : err}), using base`,
        );
      }
      const publisher = new NotePublisher();
      result = await publisher.publish(article, dryRun);
      break;
    }

    case "x": {
      const publisher = new XPublisher();
      result = await publisher.publish(article, dryRun);
      break;
    }
  }

  // Step 4: Record result
  console.log(`\n[4/4] Result: ${result!.success ? "OK" : "FAIL"}`);
  if (result!.url) console.log(`URL: ${result!.url}`);
  if (result!.error) console.log(`Error: ${result!.error}`);

  if (!dryRun) {
    recordResult(article.title, result!);
    console.log("Result recorded to data/published.json");
  }

  console.log("\n=== Done ===");
  return { article, result: result! };
}
