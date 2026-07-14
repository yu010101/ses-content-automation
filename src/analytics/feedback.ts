import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeCli } from "../utils/claude-cli.js";
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
  hookImprovementTips?: string[];
  highEngagementPatterns?: string[];
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

  const systemPrompt = `あなたはコンテンツマーケティングのデータアナリストです。
記事のパフォーマンスデータを分析し、今後の記事生成を改善するためのインサイトを抽出してください。
特に以下を重視してください：
1. テーマの多様性 — 同じネタの繰り返しを検出
2. X投稿のフック改善 — 冒頭1文のインパクト、数字・問いかけ・対比の使い分け効果を分析
3. エンゲージメント率の高い投稿パターン抽出 — タイトル構成・キーワード配置・投稿時間帯の相関を特定
分析結果は必ずJSON形式で返してください。`;
  const userContent = `以下の記事パフォーマンスデータを分析してください。

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
  "hookImprovementTips": ["X投稿フック改善の具体的提案（3つまで、例: 数字を冒頭に置く、疑問形で始める等）"],
  "highEngagementPatterns": ["エンゲージメント率が高い投稿に共通するパターン（3つまで）"],
  "topicDiversityScore": 0.0-1.0,
  "suggestedNewAngles": ["まだ試していない記事の切り口（3つまで、例: 企業分析、スキルロードマップ、キャリア事例）"]
}

topicDiversityScoreは記事タイトル一覧を分析し、テーマの多様性を0-1で評価してください（1=非常に多様、0=全て同じテーマ）。
suggestedNewAnglesは、まだ書かれていない切り口を提案してください。

JSONのみを返してください。`;
  const text = claudeCli(systemPrompt + "\n\n" + userContent);

  let analysis: Omit<LearningState, "lastUpdated">;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in feedback response");
    analysis = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`Failed to parse feedback analysis: ${text.slice(0, 200)}`);
  }

  // Fix 1: Default bestHookStyles when data is insufficient (< 3 data points)
  if (
    !analysis.bestHookStyles ||
    analysis.bestHookStyles.length === 0 ||
    analysis.bestHookStyles.some((s) => s.includes("データ不足") || s.includes("判定不可"))
  ) {
    analysis.bestHookStyles = ["number", "question"];
  }

  // Fix 2: Neutral topicDiversityScore when article count is too low to judge
  if (snapshot.articles.length < 5) {
    analysis.topicDiversityScore = Math.max(analysis.topicDiversityScore ?? 0.5, 0.5);
  }

  // Fix 3: Replace generic recommendations with actionable ones when data is sparse
  if (snapshot.articles.length < 5) {
    const sparseRecs = [
      "投稿数が少ないため、まずは毎日1記事の投稿を目標にしてください",
      "各プラットフォーム（Qiita・Zenn・Note）に最低3記事ずつ投稿し、反応の違いを比較してください",
      "タイトルにはキーワード「2026年」「徹底解説」など権威性を示す言葉を含めてください",
      "X投稿では number（数字訴求）と question（問いかけ）のhookStyleを優先的にテストしてください",
      "投稿後48時間以内のエンゲージメントを記録し、次回の分析精度を上げてください",
    ];
    // Merge: keep any Claude-generated recs that are specific, then fill with sparse recs
    const existingSpecific = (analysis.recommendations ?? []).filter(
      (r) => r.length > 15 && !r.includes("データ不足"),
    );
    analysis.recommendations = [
      ...existingSpecific.slice(0, 3),
      ...sparseRecs.filter((sr) => !existingSpecific.some((er) => er.includes(sr.slice(0, 10)))),
    ].slice(0, 7);
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
  if (state.hookImprovementTips && state.hookImprovementTips.length > 0) {
    sections.push(`- Xフック改善: ${state.hookImprovementTips.join(" / ")}`);
  }
  if (state.highEngagementPatterns && state.highEngagementPatterns.length > 0) {
    sections.push(`- 高エンゲージメントパターン: ${state.highEngagementPatterns.join(" / ")}`);
  }
  }

  if (sections.length === 0) return "";

  // Fix 4: Warn article generation when learning data is based on sparse inputs
  const isSparseData =
    state.bestKeywords.length <= 3 ||
    (state.bestHookStyles ?? []).length <= 2 &&
      (state.bestHookStyles ?? []).includes("number") &&
      (state.bestHookStyles ?? []).includes("question");

  const dataQualityNote = isSparseData
    ? `\n\n⚠️ 注意: 現在のパフォーマンスデータは蓄積が少ないため、上記の分析は暫定的です。\nデフォルト推奨値を含んでいます。独自の判断やバリエーションを積極的に試してください。`
    : "";

  // 決定論品質ゲート(ses_improve.py注入)は必ず先頭・トリム免除で生成器に届ける
  const forcedLines = (state.recommendations ?? [])
    .filter((r) => typeof r === "string" && r.startsWith("[決定論品質ゲート]"))
    .map((r) => `- ${r}`);
  // Keep learning context concise (max 3 items) to avoid prompt bloat
  const trimmedSections = [...forcedLines, ...sections.slice(0, Math.max(1, 3 - forcedLines.length))];
  return `\n## パフォーマンス指示（簡潔版）
${trimmedSections.join("\n")}${dataQualityNote}`;
}
