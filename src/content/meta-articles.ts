import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
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

  const client = new Anthropic({ apiKey: config.anthropic.apiKey() });

  // Prepare real data for the meta article
  const topArticles = snapshot.articles.slice(0, 5);
  const bottomArticles = snapshot.articles.slice(-3);

  const articleData = snapshot.articles.map((a) => ({
    title: a.title,
    date: a.publishedDate,
    qiitaViews: a.platforms.qiita?.views ?? 0,
    qiitaLikes: a.platforms.qiita?.likes ?? 0,
    qiitaStocks: a.platforms.qiita?.stocks ?? 0,
    zennLikes: a.platforms.zenn?.likes ?? 0,
    tags: a.platforms.qiita?.tags ?? [],
    engagement: a.totalEngagement,
  }));

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 8192,
    system: `あなたはSES/エンジニア向けコンテンツマーケティングの専門家です。
自社の記事パフォーマンスデータを分析した「メタ記事」を執筆してください。

## 重要
- 以下のデータは実際のパフォーマンスデータです。正確に引用してください。
- 「○○本の記事を書いて分かった」形式の一次情報記事として書いてください。
- これはSES業界のコンテンツメディアが自社データを公開する形式です。
- 読者はSESエンジニアやフリーランスに興味のあるエンジニアです。
- 5000文字以上の充実した内容にしてください。`,
    messages: [
      {
        role: "user",
        content: `以下の実際のパフォーマンスデータに基づいて、メタ記事を執筆してください。

## 全体サマリー
- 総記事数: ${snapshot.summary.totalArticles}
- 総閲覧数: ${snapshot.summary.totalViews}
- 総いいね数: ${snapshot.summary.totalLikes}
- 総ストック数: ${snapshot.summary.totalStocks}
- 平均閲覧数/記事: ${snapshot.summary.avgViewsPerArticle}

## 全記事データ
${JSON.stringify(articleData, null, 2)}

## Top 5記事
${topArticles.map((a, i) => `${i + 1}. "${a.title}" - engagement: ${a.totalEngagement}`).join("\n")}

## Bottom 3記事
${bottomArticles.map((a, i) => `${i + 1}. "${a.title}" - engagement: ${a.totalEngagement}`).join("\n")}

以下のJSON形式で返してください:
{
  "title": "メタ記事タイトル（例: Qiita/Zennで○○本のSES記事を書いて分かったバズる記事の法則）",
  "body": "記事本文（Markdown形式、5000文字以上）",
  "keywords": ["キーワード1", "キーワード2", ...],
  "summary": "要約（200文字以内）"
}

JSONのみを返してください。`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

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
