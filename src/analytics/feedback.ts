import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

export function evidenceLearningState(snapshot: PerformanceSnapshot): LearningState {
  const qiita = snapshot.articles.filter(a => a.platforms.qiita);
  const zenn = snapshot.articles.filter(a => a.platforms.zenn);
  const note = snapshot.articles.filter(a => a.platforms.note);
  return {
    lastUpdated: snapshot.collectedAt,
    bestArticleTypes: [], bestKeywords: [], bestTitlePatterns: [], bestHookStyles: [],
    highEngagementPatterns: [], hookImprovementTips: [],
    platformInsights: {
      qiita: [`取得記事 ${qiita.length} 件。閲覧・いいね・ストックは個別に扱う。累積値からタイトルの効果は判定しない。`],
      zenn: [`取得記事 ${zenn.length} 件。未取得を反応ゼロに置換しない。`],
      note: [`URL記録 ${note.length} 件。反応数・閲覧数は未計測。`],
    },
    recommendations: [
      "[決定論品質ゲート] 公開統計は出典URL・取得日・対象条件・母数・欠損数を記す。出典のない実績・個人経験を作らない。",
      "Qiita/Zennは再現できる実装・環境・コード・実測を中心にする。noteは読者が使える比較メモと具体例を中心にする。媒体ごとに本文を編集する。",
      "自社と競合は媒体・テーマ・公開後経過日をそろえて比較する。比較群が不足する場合、バズる型の断定と数値スコアを保留する。",
      "投稿件数やX投稿済み件数は成果ではない。7日/28日時点の反応と閲覧、DB遷移、相談完了を別々に記録する。",
      "年号・徹底解説・数字のフックを成功法則として自動採用しない。改善案は仮説として試し、外部参考のURLと観測日を残す。",
    ],
  };
}

export async function analyzeFeedback(): Promise<LearningState> {
  const perfPath = join(process.cwd(), "data/performance.json");
  const snapshot = JSON.parse(readFileSync(perfPath, "utf-8")) as PerformanceSnapshot;
  if (!Array.isArray(snapshot.articles) || !snapshot.collectedAt) throw new Error("Invalid performance snapshot");
  const state = evidenceLearningState(snapshot);
  // Preserve existing mandatory quality gates injected by operations.
  const previous = loadLearningState();
  const gates = (previous?.recommendations ?? []).filter(r => typeof r === "string" && r.startsWith("[決定論品質ゲート]"));
  state.recommendations = [...new Set([...gates, ...state.recommendations])];
  writeFileSync(join(process.cwd(), "data/learning-state.json"), JSON.stringify(state, null, 2), "utf-8");
  return state;
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
  const gates = state.recommendations.filter(r => r.startsWith("[決定論品質ゲート]"));
  const proposals = state.recommendations.filter(r => !r.startsWith("[決定論品質ゲート]"));
  return `\n## 編集・計測の指示（成功法則の実証ではない）\n${[...gates, ...proposals.slice(0, 5)].map(r => `- ${r}`).join("\n")}`;
}
