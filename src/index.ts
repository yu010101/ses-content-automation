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

    default:
      console.log(`SES Content Automation System

Usage:
  pipeline [--dry-run] [--skip-approval]   Run full pipeline
  trends                                    Discover current trends
  publish <platform>                        Publish to single platform

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
