import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeCli } from "../utils/claude-cli.js";
import type { PerformanceSnapshot } from "../analytics/collector.js";
import type { GeneratedArticle } from "./generator.js";

export async function generateMetaArticle(): Promise<GeneratedArticle> {
  const perfPath = join(process.cwd(), "data/performance.json");
  let snapshot: PerformanceSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(perfPath, "utf-8"));
  } catch {
    throw new Error("No performance data found. Run 'analytics' first.");
  }

  if (snapshot.articles.length < 5) {
    throw new Error(`Need at least 5 articles for meta-analysis, have ${snapshot.articles.length}`);
  }

  const articleData = snapshot.articles.map((a) => ({
    title: a.title,
    date: a.publishedDate,
    qiitaViews: a.platforms.qiita?.views ?? null,
    qiitaLikes: a.platforms.qiita?.likes ?? null,
    qiitaStocks: a.platforms.qiita?.stocks ?? null,
    zennLikes: a.platforms.zenn?.likes ?? null,
    tags: a.platforms.qiita?.tags ?? [],

  }));

  const systemPrompt = `あなたはSES/エンジニア向けコンテンツマーケティングの専門家です。
自社の記事パフォーマンスデータを分析した「メタ記事」を執筆してください。

## 重要
- 以下のデータは実際のパフォーマンスデータです。正確に引用してください。
- 「○○本の記事を書いて分かった」形式の一次情報記事として書いてください。
- これはSES業界のコンテンツメディアが自社データを公開する形式です。
- 読者はSESエンジニアやフリーランスに興味のあるエンジニアです。
- 5000文字以上の充実した内容にしてください。`;

  const userContent = `以下の実際のパフォーマンスデータに基づいて、メタ記事を執筆してください。

## 観測時点
${snapshot.collectedAt}
## 媒体別の観測値（順序に優劣の意味はない）
${JSON.stringify(articleData, null, 2)}

欠損nullは未取得。媒体横断の合算スコアや順位は作らない。
累積値であり公開後経過日もテーマも揃っていないため、タイトルや投稿時間の効果・バズる法則を推定しない。
数値は観測と限界の説明だけに用い、効果の結論は出さない。

以下のJSON形式で返してください:
{
  "title": "メタ記事タイトル（例: 記事の反応を媒体別に記録するときの欠損と限界）",
  "body": "記事本文（Markdown形式、5000文字以上）",
  "keywords": ["キーワード1", "キーワード2", ...],
  "summary": "要約（200文字以内）"
}

JSONのみを返してください。`;

  const text = claudeCli(systemPrompt + "\n\n" + userContent);

  let parsed: { title: string; body: string; keywords: string[]; summary: string };
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in meta-article response");
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Failed to parse meta-article: ${text.slice(0, 200)}`);
  }

  return {
    title: parsed.title,
    body: parsed.body,
    keywords: parsed.keywords,
    summary: parsed.summary,
    xPost: "",
    xThread: [],
    articleType: "meta-analysis",
  };
}
