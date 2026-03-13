import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverTrends } from "./trends/grok.js";
import { fetchMarketData, formatMarketContext } from "./trends/market-data.js";
import { generateArticle, generateNoteVariation, generateZennVariation } from "./content/generator.js";
import { insertRelatedLinks } from "./content/internal-links.js";
import { sendApprovalRequest, waitForApproval } from "./approval/telegram.js";
import { QiitaPublisher } from "./publishers/qiita.js";
import { ZennPublisher } from "./publishers/zenn.js";
import { XPublisher } from "./publishers/x.js";
import { NotePublisher } from "./publishers/note.js";
import type { PublishResult } from "./publishers/types.js";
import type { GeneratedArticle } from "./content/generator.js";

interface PublishedRecord {
  articles: Array<{
    title: string;
    date: string;
    platforms: PublishResult[];
  }>;
}

function loadKeywords(): string[] {
  const data = JSON.parse(
    readFileSync(join(process.cwd(), "data/keywords.json"), "utf-8"),
  );
  // Always include 2-3 high-conversion keywords for better lead gen
  const highCv: string[] = data.high_conversion ?? [];
  const rest: string[] = [...data.primary, ...data.secondary];

  // Shuffle both pools
  const shuffle = (arr: string[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  shuffle(highCv);
  shuffle(rest);

  // Pick 3 high-conversion + 7 regular
  return [...highCv.slice(0, 3), ...rest.slice(0, 7)];
}

function isDuplicate(title: string): boolean {
  try {
    const data: PublishedRecord = JSON.parse(
      readFileSync(join(process.cwd(), "data/published.json"), "utf-8"),
    );
    return data.articles.some(
      (a) => a.title.toLowerCase() === title.toLowerCase(),
    );
  } catch {
    return false;
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
  data.articles.push({
    title,
    date: new Date().toISOString(),
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
  const article: GeneratedArticle = await generateArticle(trends, keywords, marketContext);
  console.log(`Title: ${article.title}`);
  console.log(`Length: ${article.body.length} chars`);
  console.log(`Keywords: ${article.keywords.join(", ")}`);

  if (isDuplicate(article.title)) {
    console.log("WARNING: Similar article already published. Regenerating...");
  }

  // Insert internal links to past articles
  article.body = insertRelatedLinks(article.body, article.title);
  console.log(`Internal links: ${article.body.includes("## 関連記事") ? "added" : "none (first article)"}`);

  // Step 2.5: Generate Note-optimized variation
  console.log("\n[2.5/5] Generating Note variation...");
  let noteArticle: GeneratedArticle;
  try {
    noteArticle = await generateNoteVariation(article);
    noteArticle.body = insertRelatedLinks(noteArticle.body, noteArticle.title);
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
    zennArticle.body = insertRelatedLinks(zennArticle.body, zennArticle.title);
    console.log(`Zenn variation: ${zennArticle.body.length} chars`);
  } catch (err) {
    console.log(`  Zenn variation failed (${err instanceof Error ? err.message : err}), using base`);
    zennArticle = article;
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
    { publisher: new QiitaPublisher(), content: article },
    { publisher: new ZennPublisher(), content: zennArticle },
    { publisher: new XPublisher(), content: article },
    { publisher: new NotePublisher(), content: noteArticle },
  ];

  for (const { publisher: pub, content } of publishTasks) {
    console.log(`\n  Publishing to ${pub.platform}...`);
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
