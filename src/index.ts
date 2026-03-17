import { runPipeline } from "./pipeline.js";

const args = process.argv.slice(2);
const command = args[0];

const flags = {
  dryRun: args.includes("--dry-run"),
  skipApproval: args.includes("--skip-approval"),
};

async function main() {
  switch (command) {
    case "pipeline":
      await runPipeline(flags);
      break;

    case "publish": {
      const platform = args[1];
      if (!platform) {
        console.error("Usage: ses-content publish <qiita|zenn|x|note>");
        process.exit(1);
      }
      console.log(`Single-platform publish not yet implemented for: ${platform}`);
      console.log("Use 'pipeline' command to run the full workflow.");
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
  trends                                    Discover current trends
  publish <platform>                        Publish to single platform
  analytics                                 Collect & display article performance
  feedback                                  Analyze performance & update learning state
  report                                    Send daily Telegram report
  meta-article                              Generate meta-analysis article
  x-generate <article-url>                  Generate X post variations

Flags:
  --dry-run         Run without actual publishing
  --skip-approval   Skip Telegram approval step
`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
