import { XPublisher } from "./publishers/x.js";

const testArticle = {
  title: "[TEST] SES Content Automation",
  body: "test",
  keywords: ["SES"],
  summary: "test",
  articleType: "data-analysis",
  xPost: "SESコンテンツ自動化パイプラインのテスト投稿です。（このツイートはテスト後削除されます） #SES #テスト",
};

const pub = new XPublisher();
const dryRun = process.argv.includes("--dry-run");

pub.publish(testArticle, dryRun)
  .then((r) => console.log("Result:", JSON.stringify(r, null, 2)))
  .catch((err: Error) => console.error("Failed:", err.message));
