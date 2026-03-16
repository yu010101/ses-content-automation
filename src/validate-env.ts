import { config } from "./config.js";

console.log("Config validation:");

const checks: [string, () => string][] = [
  ["ANTHROPIC_API_KEY", config.anthropic.apiKey],
  ["TELEGRAM_BOT_TOKEN", config.telegram.botToken],
  ["TELEGRAM_CHAT_ID", config.telegram.chatId],
  ["XAI_API_KEY", config.xai.apiKey],
  ["QIITA_ACCESS_TOKEN", config.qiita.accessToken],
  ["GITHUB_TOKEN", config.zenn.githubToken],
  ["X_CONSUMER_KEY", config.x.consumerKey],
  ["X_CONSUMER_SECRET", config.x.consumerSecret],
  ["X_ACCESS_TOKEN", config.x.accessToken],
  ["X_ACCESS_SECRET", config.x.accessSecret],
];

let ok = 0;
let missing = 0;

for (const [name, getter] of checks) {
  try {
    getter();
    console.log(`  OK: ${name}`);
    ok++;
  } catch {
    console.log(`  MISSING: ${name}`);
    missing++;
  }
}

console.log(`\nFreelanceDB URL: ${config.freelanceDbUrl}`);
console.log(`\nResult: ${ok} set, ${missing} missing`);

if (missing > 0) {
  console.log("\nMissing keys are needed for full pipeline. Partial operation available.");
}
