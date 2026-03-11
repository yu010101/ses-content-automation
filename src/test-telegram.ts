import { sendApprovalRequest } from "./approval/telegram.js";

const testArticle = {
  title: "[TEST] SESエンジニア向けパイプラインテスト",
  body: "テスト記事本文です。これは動作確認用のダミー記事です。FreelanceDBで案件を探しましょう。",
  keywords: ["SES", "テスト"],
  summary: "パイプライン動作確認用テスト記事",
  articleType: "data-analysis",
  xThread: ["ツイート1", "ツイート2", "詳細は記事で"],
  xPost: "SESパイプラインのテスト投稿です #SES #テスト",
};

sendApprovalRequest(testArticle)
  .then(() => console.log("Telegram message sent successfully!"))
  .catch((err: Error) => console.error("Failed:", err.message));
