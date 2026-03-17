import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { PerformanceSnapshot } from "./collector.js";

export interface LearningState {
  lastUpdated: string;
  bestArticleTypes: string[];
  bestKeywords: string[];
  bestTitlePatterns: string[];
  platformInsights: {
    qiita: string[];
    zenn: string[];
    note: string[];
  };
  recommendations: string[];
}

export async function analyzeFeedback(): Promise<LearningState> {
  const perfPath = join(process.cwd(), "data/performance.json");
  let snapshot: PerformanceSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(perfPath, "utf-8"));
  } catch {
    throw new Error("No performance data found. Run 'analytics' first.");
  }

  if (snapshot.articles.length === 0) {
    throw new Error("No articles in performance data to analyze.");
  }

  const client = new Anthropic({ apiKey: config.anthropic.apiKey() });

  // Prepare performance summary for Claude
  const articleSummaries = snapshot.articles.map((a, i) => {
    const q = a.platforms.qiita;
    const z = a.platforms.zenn;
    return `${i + 1}. "${a.title}" (${a.publishedDate})
   Engagement: ${a.totalEngagement}
   ${q ? `Qiita: ${q.views} views, ${q.likes} likes, ${q.stocks} stocks, tags: ${q.tags.join(", ")}` : "Qiita: N/A"}
   ${z ? `Zenn: ${z.likes} likes, topics: ${z.topics.join(", ")}` : "Zenn: N/A"}
   ${a.platforms.note ? `Note: published` : "Note: N/A"}`;
  });

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 4096,
    system: `あなたはコンテンツマーケティングのデータアナリストです。
記事のパフォーマンスデータを分析し、今後の記事生成を改善するためのインサイトを抽出してください。
分析結果は必ずJSON形式で返してください。`,
    messages: [
      {
        role: "user",
        content: `以下の記事パフォーマンスデータを分析してください。

## パフォーマンスサマリー
- 総記事数: ${snapshot.summary.totalArticles}
- 総閲覧数: ${snapshot.summary.totalViews}
- 総いいね数: ${snapshot.summary.totalLikes}
- 総ストック数: ${snapshot.summary.totalStocks}
- 平均閲覧数/記事: ${snapshot.summary.avgViewsPerArticle}

## 記事別データ（エンゲージメントスコア順）
${articleSummaries.join("\n\n")}

以下のJSON形式で分析結果を返してください:
{
  "bestArticleTypes": ["最もエンゲージメントが高かった記事の種類（3つまで）"],
  "bestKeywords": ["高エンゲージメント記事に共通するキーワード（5つまで）"],
  "bestTitlePatterns": ["バズったタイトルのパターン（3つまで、例: 「○○から○○へ」形式）"],
  "platformInsights": {
    "qiita": ["Qiitaで効果的だったパターン（3つまで）"],
    "zenn": ["Zennで効果的だったパターン（3つまで）"],
    "note": ["Note向けの改善提案（3つまで）"]
  },
  "recommendations": ["次回の記事生成への具体的な提案（5つまで）"]
}

JSONのみを返してください。`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  let analysis: Omit<LearningState, "lastUpdated">;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in feedback response");
    analysis = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Failed to parse feedback analysis: ${text.slice(0, 200)}`);
  }

  const learningState: LearningState = {
    lastUpdated: new Date().toISOString(),
    ...analysis,
  };

  // Save learning state
  const learningPath = join(process.cwd(), "data/learning-state.json");
  writeFileSync(learningPath, JSON.stringify(learningState, null, 2), "utf-8");
  console.log(`  Learning state saved to ${learningPath}`);

  return learningState;
}

export function loadLearningState(): LearningState | null {
  try {
    const learningPath = join(process.cwd(), "data/learning-state.json");
    return JSON.parse(readFileSync(learningPath, "utf-8"));
  } catch {
    return null;
  }
}

export function formatLearningContext(state: LearningState): string {
  const sections: string[] = [];

  if (state.bestArticleTypes.length > 0) {
    sections.push(`- 高パフォーマンス記事タイプ: ${state.bestArticleTypes.join(", ")}`);
  }
  if (state.bestKeywords.length > 0) {
    sections.push(`- 効果的なキーワード: ${state.bestKeywords.join(", ")}`);
  }
  if (state.bestTitlePatterns.length > 0) {
    sections.push(`- バズるタイトルパターン: ${state.bestTitlePatterns.join(" / ")}`);
  }
  if (state.recommendations.length > 0) {
    sections.push(`- 改善提案:\n${state.recommendations.map((r) => `  - ${r}`).join("\n")}`);
  }

  if (sections.length === 0) return "";

  return `\n## パフォーマンスデータに基づく指示
過去の記事分析から、以下のパターンが高エンゲージメントにつながっています。
70%はこれらの勝ちパターンを踏襲し、30%は新しいテーマで探索してください。

${sections.join("\n")}`;
}
