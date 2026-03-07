import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverTrends } from "./trends/grok.js";
import { generateArticle } from "./content/generator.js";
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
  const all: string[] = [...data.primary, ...data.secondary];
  // Shuffle and pick 10
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, 10);
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

  // Step 2: Generate article
  console.log("\n[2/5] Generating article via Claude...");
  const keywords = loadKeywords();
  const article: GeneratedArticle = await generateArticle(trends, keywords);
  console.log(`Title: ${article.title}`);
  console.log(`Length: ${article.body.length} chars`);
  console.log(`Keywords: ${article.keywords.join(", ")}`);

  if (isDuplicate(article.title)) {
    console.log("WARNING: Similar article already published. Regenerating...");
    // In production, would retry with different angle
  }

  // Step 3: Telegram approval
  if (!skipApproval && !dryRun) {
    console.log("\n[3/5] Sending for Telegram approval...");
    await sendApprovalRequest(article);
    const approved = await waitForApproval();
    if (!approved) {
      console.log("Article rejected or timed out. Pipeline stopped.");
      return;
    }
    console.log("Article approved!");
  } else {
    console.log("\n[3/5] Skipping approval (dry-run or --skip-approval)");
  }

  // Step 4: Publish to all platforms
  console.log("\n[4/5] Publishing to platforms...");
  const publishers = [
    new QiitaPublisher(),
    new ZennPublisher(),
    new XPublisher(),
    new NotePublisher(),
  ];

  const results: PublishResult[] = [];
  let qiitaUrl: string | undefined;

  for (const pub of publishers) {
    console.log(`\n  Publishing to ${pub.platform}...`);
    try {
      let result: PublishResult;
      if (pub instanceof XPublisher) {
        result = await pub.publish(article, dryRun, qiitaUrl);
      } else {
        result = await pub.publish(article, dryRun);
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
