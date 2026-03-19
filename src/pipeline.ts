import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverTrends } from "./trends/grok.js";
import { fetchMarketData, formatMarketContext } from "./trends/market-data.js";
import { generateArticle, generateNoteVariation, generateZennVariation, generateQiitaVariation } from "./content/generator.js";
import { insertRelatedLinks } from "./content/internal-links.js";
import { sendApprovalRequest, waitForApproval } from "./approval/telegram.js";
import { QiitaPublisher } from "./publishers/qiita.js";
import { ZennPublisher } from "./publishers/zenn.js";
import { XPublisher } from "./publishers/x.js";
import { NotePublisher } from "./publishers/note.js";
import { loadLearningState, formatLearningContext } from "./analytics/feedback.js";
import { generateXVariations, addToXQueue } from "./x-amplification/bridge.js";
import { extractQiitaItemId } from "./analytics/qiita-stats.js";
import { extractZennSlug } from "./analytics/zenn-stats.js";
import type { PublishResult } from "./publishers/types.js";
import type { GeneratedArticle } from "./content/generator.js";

interface PublishedRecord {
  articles: Array<{
    title: string;
    date: string;
    articleId?: string;
    platforms: PublishResult[];
  }>;
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

  // Always inject 1-2 angle_seeds for topic diversity
  shuffle(angleSeedsAll);
  const angleSeeds = angleSeedsAll.slice(0, 2);

  // Phase 3: Use learning-state bestKeywords (70/30 strategy)
  const learning = loadLearningState();
  if (learning && learning.bestKeywords.length > 0) {
    const bestKw = [...learning.bestKeywords];
    shuffle(bestKw);
    shuffle(highCv);
    shuffle(rest);

    // 70% from proven keywords, 30% exploration
    const proven = bestKw.slice(0, 3);
    const exploratory = [...highCv.slice(0, 2), ...rest.slice(0, 3)];
    return [...proven, ...exploratory, ...angleSeeds];
  }

  // Fallback: original behavior
  shuffle(highCv);
  shuffle(rest);
  return [...highCv.slice(0, 3), ...rest.slice(0, 5), ...angleSeeds];
}

function loadTechKeywords(): string[] {
  const data = JSON.parse(
    readFileSync(join(process.cwd(), "data/keywords.json"), "utf-8"),
  );
  const tech: string[] = data.tech_keywords ?? [];
  const ai: string[] = data.ai_keywords ?? [];

  const shuffle = (arr: string[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  shuffle(tech);
  shuffle(ai);

  // Pick 5 tech + 5 AI keywords for Qiita/Zenn
  return [...tech.slice(0, 5), ...ai.slice(0, 5)];
}

interface DiversityCheck {
  isDuplicate: boolean;
  isTooSimilar: boolean;
  recentTitles: string[];
}

function checkDiversity(title: string): DiversityCheck {
  try {
    const data: PublishedRecord = JSON.parse(
      readFileSync(join(process.cwd(), "data/published.json"), "utf-8"),
    );

    const isDuplicate = data.articles.some(
      (a) => a.title.toLowerCase() === title.toLowerCase(),
    );

    // Check recent 7 days of articles
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentArticles = data.articles.filter((a) => a.date >= sevenDaysAgo);
    const recentTitles = recentArticles.map((a) => a.title);

    // Check keyword overlap with recent titles
    const commonWords = ["SES", "フリーランス", "エンジニア", "転職", "年収", "脱出", "転向", "比較", "完全ガイド", "徹底", "最新", "2026"];
    const titleWords = commonWords.filter((w) => title.includes(w));
    let isTooSimilar = false;

    if (recentTitles.length > 0 && titleWords.length > 0) {
      const overlapScores = recentTitles.map((recent) => {
        const recentWords = commonWords.filter((w) => recent.includes(w));
        if (recentWords.length === 0) return 0;
        const overlap = titleWords.filter((w) => recentWords.includes(w)).length;
        return overlap / Math.max(titleWords.length, recentWords.length);
      });
      // If any recent title has 70%+ keyword overlap, it's too similar
      isTooSimilar = overlapScores.some((score) => score >= 0.7);
    }

    return { isDuplicate, isTooSimilar, recentTitles };
  } catch {
    return { isDuplicate: false, isTooSimilar: false, recentTitles: [] };
  }
}

function recordPublished(title: string, results: PublishResult[]) {
  const filePath = join(process.cwd(), "data/published.json");
  let data: PublishedRecord;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    data = { articles: [] };
  }

  // Extract articleIds from platform URLs for analytics lookup
  const qiitaResult = results.find((r) => r.platform === "qiita" && r.success && r.url);
  const zennResult = results.find((r) => r.platform === "zenn" && r.success && r.url);
  const qiitaItemId = qiitaResult?.url ? extractQiitaItemId(qiitaResult.url) : null;
  const zennSlug = zennResult?.url ? extractZennSlug(zennResult.url) : null;

  const articleId = qiitaItemId || zennSlug || undefined;

  data.articles.push({
    title,
    date: new Date().toISOString(),
    articleId,
    platforms: results,
  });
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function runPipeline(options: { dryRun?: boolean; skipApproval?: boolean } = {}) {
  const { dryRun = false, skipApproval = false } = options;

  console.log("=== SES Content Automation Pipeline ===");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // Step 1: Discover trends
  console.log("[1/5] Discovering trends via Grok...");
  let trends: Awaited<ReturnType<typeof discoverTrends>> = [];
  try {
    trends = await discoverTrends();
    console.log(`Found ${trends.length} trends:`);
    trends.forEach((t) => console.log(`  - ${t.topic} (${t.relevanceScore.toFixed(2)})`));
  } catch (err) {
    console.log(`  Grok API unavailable (${err instanceof Error ? err.message : err})`);
    console.log("  Falling back to keyword-only article generation.");
  }

  // Step 1.5: Fetch market data
  let marketContext = "";
  try {
    console.log("\n[1.5/5] Fetching market data via Grok...");
    const marketData = await fetchMarketData();
    marketContext = formatMarketContext(marketData);
    console.log(`  Sources: ${marketData.sources.length}, Facts: ${marketData.rawFacts.length}`);
  } catch (err) {
    console.log(`  Market data unavailable (${err instanceof Error ? err.message : err})`);
  }

  // Step 2: Generate article
  console.log("\n[2/5] Generating article via Claude...");
  const keywords = loadKeywords();

  // Inject learning context from past performance analysis
  let learningContext = "";
  const learningState = loadLearningState();
  if (learningState) {
    learningContext = formatLearningContext(learningState);
    console.log(`  Learning state loaded (updated: ${learningState.lastUpdated})`);
  }

  const article: GeneratedArticle = await generateArticle(trends, keywords, marketContext, learningContext);
  console.log(`Title: ${article.title}`);
  console.log(`Length: ${article.body.length} chars`);
  console.log(`Keywords: ${article.keywords.join(", ")}`);

  const diversity = checkDiversity(article.title);
  if (diversity.isDuplicate) {
    console.log("WARNING: Exact duplicate title detected.");
  }
  if (diversity.isTooSimilar) {
    console.log("WARNING: Topic too similar to recent articles. Angle seeds injected for diversity.");
    console.log(`  Recent titles: ${diversity.recentTitles.slice(0, 3).join(" / ")}`);
  }

  // Insert internal links to past articles
  article.body = insertRelatedLinks(article.body, article.title);
  console.log(`Internal links: ${article.body.includes("## 関連記事") ? "added" : "none (first article)"}`);

  // Step 2.5: Generate Note-optimized variation
  console.log("\n[2.5/5] Generating Note variation...");
  let noteArticle: GeneratedArticle;
  try {
    noteArticle = await generateNoteVariation(article);
    console.log(`Note title: ${noteArticle.title}`);
  } catch (err) {
    console.log(`  Note variation failed (${err instanceof Error ? err.message : err}), using base`);
    noteArticle = article;
  }

  // Step 2.6: Generate Zenn CTA-free variation
  console.log("\n[2.6/5] Generating Zenn AI article...");
  let zennArticle: GeneratedArticle;
  try {
    zennArticle = await generateZennVariation(article);
    console.log(`Zenn variation: ${zennArticle.body.length} chars`);
  } catch (err) {
    console.log(`  Zenn variation failed (${err instanceof Error ? err.message : err}), using base`);
    zennArticle = article;
  }

  // Step 2.7: Generate Qiita tech variation
  console.log("\n[2.7/5] Generating Qiita tech article...");
  let qiitaArticle: GeneratedArticle;
  try {
    qiitaArticle = await generateQiitaVariation(article);
    console.log(`Qiita tech variation: ${qiitaArticle.body.length} chars`);
  } catch (err) {
    console.log(`  Qiita tech variation failed (${err instanceof Error ? err.message : err}), using base`);
    qiitaArticle = article;
  }

  // Step 3: Telegram approval
  const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== "your-telegram-bot-token";
  if (!skipApproval && !dryRun && hasTelegram) {
    console.log("\n[3/5] Sending for Telegram approval...");
    await sendApprovalRequest(article);
    const approved = await waitForApproval();
    if (!approved) {
      console.log("Article rejected or timed out. Pipeline stopped.");
      return;
    }
    console.log("Article approved!");
  } else {
    const reason = !hasTelegram ? "no Telegram token" : dryRun ? "dry-run" : "--skip-approval";
    console.log(`\n[3/5] Skipping approval (${reason})`);
  }

  // Step 4: Publish to all platforms (each gets optimized content)
  console.log("\n[4/5] Publishing to platforms...");
  const results: PublishResult[] = [];
  let qiitaUrl: string | undefined;

  // Platform → article mapping: Note gets its own variation
  const publishTasks: Array<{ publisher: QiitaPublisher | ZennPublisher | XPublisher | NotePublisher; content: GeneratedArticle }> = [
    { publisher: new QiitaPublisher(), content: qiitaArticle },
    { publisher: new ZennPublisher(), content: zennArticle },
    { publisher: new XPublisher(), content: article },
    { publisher: new NotePublisher(), content: noteArticle },
  ];

  for (const { publisher: pub, content } of publishTasks) {
    console.log(`\n  Publishing to ${pub.platform}...`);

    // Cross-platform links: inject Qiita URL into Zenn/Note articles
    if (qiitaUrl && (pub.platform === "zenn" || pub.platform === "note")) {
      const crossLink = `\n\n---\n\n${pub.platform === "zenn" ? "Qiitaでコード付き解説も公開しています" : "技術的な詳細はQiitaでも解説しています"}: ${qiitaUrl}`;
      if (!content.body.includes(qiitaUrl)) {
        content.body += crossLink;
      }
    }

    try {
      let result: PublishResult;
      if (pub instanceof XPublisher) {
        result = await pub.publish(content, dryRun, qiitaUrl);
      } else {
        result = await pub.publish(content, dryRun);
      }
      results.push(result);
      if (pub.platform === "qiita" && result.url) {
        qiitaUrl = result.url;
      }
      console.log(`  ${result.success ? "OK" : "FAIL"}: ${result.url || result.error}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ERROR: ${message}`);
      results.push({ platform: pub.platform, success: false, error: message });
    }
  }

  // Step 5: Record results
  console.log("\n[5/5] Recording results...");
  if (!dryRun) {
    recordPublished(article.title, results);
  }

  // Step 5.5: Generate X post variations and add to queue
  if (!dryRun && qiitaUrl) {
    try {
      console.log("\n[5.5] Generating X post variations...");
      const xVariations = await generateXVariations(article, qiitaUrl);
      addToXQueue(article.title, qiitaUrl, xVariations);
    } catch (err) {
      console.log(`  X variation generation failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Summary
  console.log("\n=== Pipeline Complete ===");
  const succeeded = results.filter((r) => r.success).length;
  console.log(`Results: ${succeeded}/${results.length} platforms succeeded`);
  results.forEach((r) => {
    const icon = r.success ? "OK" : "FAIL";
    console.log(`  [${icon}] ${r.platform}: ${r.url || r.error}`);
  });

  return { article, results };
}
