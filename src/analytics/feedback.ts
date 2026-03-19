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
  bestHookStyles?: string[];
  topicDiversityScore?: number;
  suggestedNewAngles?: string[];
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

  // Load X queue data for hookStyle analysis
  let xHookSummary = "";
  try {
    const xQueuePath = join(process.cwd(), "data/x-queue.json");
    const xQueue = JSON.parse(readFileSync(xQueuePath, "utf-8"));
    const hookCounts: Record<string, { total: number; posted: number }> = {};
    for (const entry of xQueue.entries) {
      for (let i = 0; i < entry.variations.length; i++) {
        const v = entry.variations[i];
        const style = v.hookStyle ?? "unknown";
        if (!hookCounts[style]) hookCounts[style] = { total: 0, posted: 0 };
        hookCounts[style].total++;
        if (entry.posted[i]) hookCounts[style].posted++;
      }
    }
    const lines = Object.entries(hookCounts).map(
      ([style, { total, posted }]) => `  ${style}: ${posted}/${total} posted`,
    );
    if (lines.length > 0) {
      xHookSummary = `\n\n## X投稿hookStyle別データ\n${lines.join("\n")}`;
    }
  } catch {
    // No X queue data available
  }

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

  // Build title list for diversity analysis
  const titleList = snapshot.articles.map((a) => `「${a.title}」`).join("\n");

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 4096,
    system: `あなたはコンテンツマーケティングのデータアナリストです。
記事のパフォーマンスデータを分析し、今後の記事生成を改善するためのインサイトを抽出してください。
特に「テーマの多様性」を重視し、同じネタの繰り返しを検出してください。
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
${articleSummaries.join("\n\n")}${xHookSummary}

## 記事タイトル一覧（テーマ多様性分析用）
${titleList}

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
  "recommendations": ["次回の記事生成への具体的な提案（5つまで）"],
  "bestHookStyles": ["X投稿で効果的だったhookStyle（question/number/statement/contrastから、データがあれば）"],
  "topicDiversityScore": 0.0-1.0,
  "suggestedNewAngles": ["まだ試していない記事の切り口（3つまで、例: 企業分析、スキルロードマップ、キャリア事例）"]
}

topicDiversityScoreは記事タイトル一覧を分析し、テーマの多様性を0-1で評価してください（1=非常に多様、0=全て同じテーマ）。
suggestedNewAnglesは、まだ書かれていない切り口を提案してください。

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

  // Diversity warning (top priority)
  if (state.topicDiversityScore !== undefined && state.topicDiversityScore < 0.4) {
    const angles = state.suggestedNewAngles?.length
      ? state.suggestedNewAngles.map((a) => `  - ${a}`).join("\n")
      : "  - 企業の見分け方・面談テクニック\n  - スキルロードマップ・技術選定\n  - キャリアパス事例・年収推移ストーリー";
    sections.push(`⚠️ 直近記事のテーマが偏っています（多様性スコア: ${state.topicDiversityScore.toFixed(1)}）。以下の新しい切り口を優先してください:\n${angles}`);
  }

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
勝ちパターンを参考にしつつ、テーマの多様性を確保してください。

${sections.join("\n")}`;
}
