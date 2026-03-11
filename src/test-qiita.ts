import { QiitaPublisher } from "./publishers/qiita.js";

const pub = new QiitaPublisher();
const article = {
  title: "[TEST] SESエンジニア向け自動投稿テスト",
  body: "## テスト\nこれはパイプラインの動作確認用テスト記事です。\n\n確認後すぐに削除します。",
  keywords: ["SES", "テスト"],
  summary: "テスト",
  articleType: "data-analysis",
  xPost: "テスト",
};

pub
  .publish(article, false)
  .then((r) => console.log("Result:", JSON.stringify(r, null, 2)))
  .catch((e: Error) => console.error("Failed:", e.message));
