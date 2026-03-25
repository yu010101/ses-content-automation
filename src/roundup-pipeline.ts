import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateRoundupArticle, generateNoteVariation, generateRoundupZennVariation, generateRoundupQiitaVariation } from "./content/generator.js";
import type { RoundupSeed } from "./content/generator.js";
import { insertRelatedLinks } from "./content/internal-links.js";
import { sendApprovalRequest, waitForApproval } from "./approval/telegram.js";
import { QiitaPublisher } from "./publishers/qiita.js";
import { ZennPublisher } from "./publishers/zenn.js";
import { XPublisher } from "./publishers/x.js";
import { NotePublisher } from "./publishers/note.js";
import { fetchMarketData, formatMarketContext } from "./trends/market-data.js";
import { generateXVariations, addToXQueue } from "./x-amplification/bridge.js";
import { extractQiitaItemId } from "./analytics/qiita-stats.js";
import { extractZennSlug } from "./analytics/zenn-stats.js";
import type { PublishResult } from "./publishers/types.js";
import type { GeneratedArticle } from "./content/generator.js";

interface RoundupSeeds {
  seeds: RoundupSeed[];
}

interface PublishedRecord {
  articles: Array<{
    title: string;
    date: string;
    articleId?: string;
    platforms: PublishResult[];
  }>;
}

function loadSeeds(): RoundupSeeds {
  return JSON.parse(
    readFileSync(join(process.cwd(), "data/roundup-seeds.json"), "utf-8"),
  );
}

function selectSeed(category?: string): RoundupSeed {
  const { seeds } = loadSeeds();

  if (category) {
    const match = seeds.find((s) => s.category === category);
    if (!match) {
      throw new Error(
        `Category "${category}" not found. Available: ${seeds.map((s) => s.category).join(", ")}`,
      );
    }
    return match;
  }

  // Auto-select: pick the least recently used category
  let published: PublishedRecord;
  try {
    published = JSON.parse(
      readFileSync(join(process.cwd(), "data/published.json"), "utf-8"),
    );
  } catch {
    published = { articles: [] };
  }

  const usedCategories = new Set<string>();
  for (const article of published.articles) {
    for (const seed of seeds) {
      if (article.title.includes(seed.title_hint)) {
        usedCategories.add(seed.category);
      }
    }
  }

  // Pick first unused category, or rotate back to the start
  const unused = seeds.filter((s) => !usedCategories.has(s.category));
  return unused.length > 0 ? unused[0] : seeds[0];
}

function recordPublished(title: string, results: PublishResult[]) {
  const filePath = join(process.cwd(), "data/published.json");
  let data: PublishedRecord;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    data = { articles: [] };
  }

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

export async function runRoundupPipeline(options: {
  dryRun?: boolean;
  skipApproval?: boolean;
  category?: string;
} = {}) {
  const { dryRun = false, skipApproval = false, category } = options;

  console.log("=== AI/Tool Roundup Pipeline ===");
  console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  // Step 1: Select seed
  console.log("[1/5] Selecting roundup topic...");
  const seed = selectSeed(category);
  console.log(`  Category: ${seed.category}`);
  console.log(`  Topic: ${seed.title_hint}`);
  console.log(`  Tools: ${seed.items.join(", ")}`);

  // Step 1.5: Fetch market data
  let marketContext = "";
  try {
    console.log("\n[1.5/5] Fetching market data via Grok...");
    const marketData = await fetchMarketData();
    marketContext = formatMarketContext(marketData);
  } catch (err) {
    console.log(`  Market data unavailable (${err instanceof Error ? err.message : err})`);
  }

  // Step 2: Generate roundup article (Grok research → Claude generation)
  console.log("\n[2/5] Generating roundup article...");
  const article: GeneratedArticle = await generateRoundupArticle(seed, marketContext);
  console.log(`  Title: ${article.title}`);
  console.log(`  Length: ${article.body.length} chars`);
  console.log(`  Keywords: ${article.keywords.join(", ")}`);

  // Verify quality
  const codeBlockCount = (article.body.match(/```/g) || []).length / 2;
  const hasTierClassification = /Tier\s*[123]/i.test(article.body) || /必須級|推奨|選択型/.test(article.body);
  const hasComparisonTable = article.body.includes("|") && article.body.includes("---");
  console.log(`  Code blocks: ${Math.floor(codeBlockCount)}`);
  console.log(`  Tier classification: ${hasTierClassification ? "YES" : "NO"}`);
  console.log(`  Comparison table: ${hasComparisonTable ? "YES" : "NO"}`);

  // Insert internal links
  article.body = insertRelatedLinks(article.body, article.title);

  // Step 2.5-2.7: Generate platform variations
  console.log("\n[2.5/5] Generating Note variation...");
  let noteArticle: GeneratedArticle;
  try {
    noteArticle = await generateNoteVariation(article);
  } catch {
    noteArticle = article;
  }

  console.log("[2.6/5] Generating Zenn variation...");
  let zennArticle: GeneratedArticle;
  try {
    zennArticle = await generateRoundupZennVariation(article);
  } catch {
    zennArticle = article;
  }

  console.log("[2.7/5] Generating Qiita variation...");
  let qiitaArticle: GeneratedArticle;
  try {
    // Override keywords with seed's qiita_tags for better tag matching
    const enrichedArticle = { ...article, keywords: [...article.keywords, ...seed.qiita_tags] };
    qiitaArticle = await generateRoundupQiitaVariation(enrichedArticle);
  } catch {
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

  // Step 4: Publish to all platforms
  console.log("\n[4/5] Publishing to platforms...");
  const results: PublishResult[] = [];
  let qiitaUrl: string | undefined;

  const publishTasks: Array<{ publisher: QiitaPublisher | ZennPublisher | XPublisher | NotePublisher; content: GeneratedArticle }> = [
    { publisher: new QiitaPublisher(), content: qiitaArticle },
    { publisher: new ZennPublisher(), content: zennArticle },
    { publisher: new XPublisher(), content: article },
    { publisher: new NotePublisher(), content: noteArticle },
  ];

  for (const { publisher: pub, content } of publishTasks) {
    console.log(`\n  Publishing to ${pub.platform}...`);

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

  // Step 5.5: Generate X post variations
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
  console.log("\n=== Roundup Pipeline Complete ===");
  const succeeded = results.filter((r) => r.success).length;
  console.log(`Results: ${succeeded}/${results.length} platforms succeeded`);
  results.forEach((r) => {
    const icon = r.success ? "OK" : "FAIL";
    console.log(`  [${icon}] ${r.platform}: ${r.url || r.error}`);
  });

  return { article, results };
}
