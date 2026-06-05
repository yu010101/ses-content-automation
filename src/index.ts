import { runPipeline } from "./pipeline.js";
import { runRoundupPipeline } from "./roundup-pipeline.js";

const args = process.argv.slice(2);
const command = args[0];

const flags = {
  dryRun: args.includes("--dry-run"),
  skipApproval: args.includes("--skip-approval"),
  category: args.find((a) => a.startsWith("--category="))?.split("=")[1],
};

async function main() {
  switch (command) {
    case "pipeline":
      await runPipeline(flags);
      break;

    case "publish": {
      const platform = args[1];
      const validPlatforms = ["qiita", "zenn", "x", "note"] as const;
      type Platform = (typeof validPlatforms)[number];
      if (!platform || !validPlatforms.includes(platform as Platform)) {
        console.error("Usage: ses-content publish <qiita|zenn|x|note> [--dry-run]");
        process.exit(1);
      }

      const { publishSinglePlatform } = await import("./publish-single.js");
      await publishSinglePlatform(platform as Platform, flags);
      break;
    }

    case "trends": {
      const { discoverTrends } = await import("./trends/grok.js");
      const trends = await discoverTrends();
      console.log(JSON.stringify(trends, null, 2));
      break;
    }

    case "analytics": {
      const { collectPerformanceData, displayPerformanceRanking } = await import("./analytics/collector.js");
      console.log("=== Collecting Performance Data ===\n");
      const snapshot = await collectPerformanceData();
      displayPerformanceRanking(snapshot);
      break;
    }

    case "feedback": {
      const { analyzeFeedback } = await import("./analytics/feedback.js");
      console.log("=== Analyzing Performance Feedback ===\n");
      const state = await analyzeFeedback();
      console.log("\nLearning State:");
      console.log(`  Best article types: ${state.bestArticleTypes.join(", ")}`);
      console.log(`  Best keywords: ${state.bestKeywords.join(", ")}`);
      console.log(`  Best title patterns: ${state.bestTitlePatterns.join(", ")}`);
      console.log(`  Recommendations:`);
      for (const rec of state.recommendations) {
        console.log(`    - ${rec}`);
      }
      break;
    }

    case "report": {
      const { sendDailyReport } = await import("./analytics/reporter.js");
      console.log("=== Sending Daily Report ===\n");
      await sendDailyReport();
      break;
    }

    case "meta-article": {
      const { generateMetaArticle } = await import("./content/meta-articles.js");
      console.log("=== Generating Meta Article ===\n");
      const article = await generateMetaArticle();
      console.log(`Title: ${article.title}`);
      console.log(`Length: ${article.body.length} chars`);
      console.log(`Keywords: ${article.keywords.join(", ")}`);
      console.log("\nTo publish, pipe through the pipeline or use the generated content directly.");
      break;
    }

    case "x-post": {
      const slot = args[1] as "morning" | "noon" | "evening" | undefined;
      if (!slot || !["morning", "noon", "evening"].includes(slot)) {
        console.error("Usage: ses-content x-post <morning|noon|evening> [--dry-run]");
        process.exit(1);
      }
      const { getNextUnpostedVariation, markAsPosted, injectCta } = await import("./x-amplification/bridge.js");
      const { XPublisher } = await import("./publishers/x.js");

      const next = getNextUnpostedVariation(slot);
      if (!next) {
        console.log(`[X] No unposted variations for slot: ${slot}`);
        break;
      }

      const { entry, variationIndex, variation } = next;
      console.log(`[X] Posting: [${variation.type}] (${variation.hookStyle}) ${variation.text.slice(0, 60)}...`);

      const finalText = injectCta(variation.text, entry.articleUrl, variation.hookStyle);
      const publisher = new XPublisher();
      const result = await publisher.publishSingle(finalText, variation.postType, flags.dryRun);

      if (result.success) {
        markAsPosted(entry.articleTitle, variationIndex, result.tweetId);
        console.log(`[X] Success: ${result.url}`);
      } else {
        console.error(`[X] Failed: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case "roundup":
      await runRoundupPipeline(flags);
      break;

    case "x-quote": {
      const { executeQuoteRepost } = await import("./x-amplification/quote-repost.js");
      console.log("=== Quote Repost ===\n");
      const quoteResult = await executeQuoteRepost(flags.dryRun);
      if (quoteResult.success) {
        console.log(`\nTarget: @${quoteResult.target}`);
        console.log(`Comment: ${quoteResult.comment}`);
        if (quoteResult.tweetId) console.log(`Tweet ID: ${quoteResult.tweetId}`);
      } else {
        console.error(`Failed: ${quoteResult.error}`);
        process.exit(1);
      }
      break;
    }

    case "x-backfill": {
      const { generateXVariations, addToXQueue, loadXQueue } = await import("./x-amplification/bridge.js");
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const limitArg = args.find((a) => a.startsWith("--limit="));
      const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 5;
      console.log("=== X Queue Backfill (last " + limit + " articles) ===\n");
      const published = JSON.parse(readFileSync(join(process.cwd(), "data/published.json"), "utf-8"));
      const queue = loadXQueue();
      const queuedTitles = new Set(queue.entries.map((e: { articleTitle: string }) => e.articleTitle));
      const recent = (published.articles as Array<{ title: string; date: string; platforms: Array<{ platform: string; success: boolean; url?: string }> }>)
        .filter((a) => a.platforms.some((p) => p.success && p.url && !p.url.includes("draft")))
        .filter((a) => !queuedTitles.has(a.title))
        .slice(-limit);
      console.log("Backfilling " + recent.length + " articles (skipped " + queuedTitles.size + " already queued)");
      for (const a of recent) {
        const url = a.platforms.find((p) => p.success && p.url && !p.url.includes("draft"))?.url ?? "";
        if (!url) continue;
        console.log("\n→ " + a.title + "\n  url: " + url);
        const fakeArticle = { title: a.title, body: "", keywords: [], summary: "", xPost: "", xThread: [], articleType: "" };
        try {
          const variations = await generateXVariations(fakeArticle, url);
          addToXQueue(a.title, url, variations);
          console.log("  Added " + variations.length + " variations");
        } catch (e) {
          console.error("  Failed: " + (e instanceof Error ? e.message : String(e)));
        }
      }
      console.log("\n=== Backfill Complete ===");
      break;
    }

    case "x-generate": {
      const { generateXVariations, addToXQueue } = await import("./x-amplification/bridge.js");
      const articleUrl = args[1];
      if (!articleUrl) {
        console.error("Usage: ses-content x-generate <article-url>");
        process.exit(1);
      }
      console.log("=== Generating X Post Variations ===\n");
      // Load latest article from published.json for context
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const published = JSON.parse(readFileSync(join(process.cwd(), "data/published.json"), "utf-8"));
      const latest = published.articles[published.articles.length - 1];
      if (!latest) {
        console.error("No articles found in published.json");
        process.exit(1);
      }
      const fakeArticle = {
        title: latest.title,
        body: "",
        keywords: [],
        summary: "",
        xPost: "",
        xThread: [],
        articleType: "",
      };
      const variations = await generateXVariations(fakeArticle, articleUrl);
      addToXQueue(latest.title, articleUrl, variations);
      for (const v of variations) {
        console.log(`[${v.type}] (${v.scheduledSlot}) ${v.text}`);
      }
      break;
    }

    default:
      console.log(`SES Content Automation System

Usage:
  pipeline [--dry-run] [--skip-approval]   Run full pipeline
  roundup [--dry-run] [--category=...]     AI/tool roundup article
  trends                                    Discover current trends
  publish <platform>                        Publish to single platform
  analytics                                 Collect & display article performance
  feedback                                  Analyze performance & update learning state
  report                                    Send daily Telegram report
  meta-article                              Generate meta-analysis article
  x-generate <article-url>                  Generate X post variations
  x-post <morning|noon|evening>             Post next queued X variation
  x-quote [--dry-run]                       Quote repost influencer tweet
  x-backfill [--limit=5]                    Backfill x-queue from past published articles

Flags:
  --dry-run         Run without actual publishing
  --skip-approval   Skip Telegram approval step
  --category=<cat>  Specify roundup category (e.g. ai-coding)
`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
