import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeCli } from "../utils/claude-cli.js";
import { loadLearningState } from "../analytics/feedback.js";
import type { GeneratedArticle } from "../content/generator.js";

export interface XPostVariation {
  type: "teaser" | "key-point" | "data-highlight" | "discussion" | "quote";
  text: string;
  scheduledSlot?: "morning" | "noon" | "evening";
  postType: "text" | "long_text";
  hookStyle: "question" | "number" | "statement" | "contrast";
  abVariant?: "A" | "B";
  postedAt?: string;
  tweetId?: string;
}

export interface XQueueEntry {
  articleTitle: string;
  articleUrl: string;
  createdAt: string;
  variations: XPostVariation[];
  posted: boolean[];
}

export interface XQueue {
  entries: XQueueEntry[];
}

export function injectCta(
  text: string,
  articleUrl: string,
  _hookStyle: string,
): string {
  const ctaUrl = "https://note.com/l_mrk/membership";
  const articleLine = `\n${articleUrl}`;
  const ctaLine = `\n${ctaUrl}`;

  // For text posts (280 char limit), only append article URL
  // For long_text, append both article URL and CTA
  const combined = text + articleLine + ctaLine;
  if (combined.length <= 280) {
    return combined;
  }

  // Falls back to article URL only if CTA doesn't fit
  const withArticle = text + articleLine;
  if (withArticle.length <= 280) {
    return withArticle;
  }

  // Truncate text to fit article URL within 280
  const available = 280 - articleLine.length - 1; // -1 for ellipsis
  return text.slice(0, available) + "…" + articleLine;
}

export async function generateXVariations(
  article: GeneratedArticle,
  articleUrl: string,
): Promise<XPostVariation[]> {
  // Load learning state for hookStyle weighting
  const learningState = loadLearningState();
  const bestHooks = learningState?.bestHookStyles ?? [];
  const hookGuidance = bestHooks.length > 0
    ? `\n\n過去データから効果的なhookStyle: ${bestHooks.join(", ")}。これらを70%の確率で使用してください。`
    : "";

  const systemPrompt = `あなたは合同会社Radineerの代表で、Claude Code・OpenClaw・AI経営OSを毎日使っている実践者です。

【重要ルール】
1. 必ず280文字以上で書くこと（短すぎる投稿はリーチが下がる）
2. 末尾は必ず読者への「問いかけ」で締めること（例: 「みんなはどう思う？」「試した人いる？」）
3. 問いかけはリプライを誘発する具体的な質問にすること
1つの記事から6種類の長文Xポスト（各800-1500文字）を作成してください。

## テーマ（これだけ）
- Claude Code の実践Tips（コマンド、設定、workflow、CLAUDE.md）
- OpenClaw の使い方・設定・エージェント構築
- AI経営OS構築の裏側（9エージェント: CFO/COO/CMO/CEO/Brain/Kaizen/Screen/CareerBoost）
- Claude Code × OpenClaw連携の実例
- AI駆動塾の宣伝（noteメンバーシップ）

## スタイル
- 1行目: キャッチーなフック（具体的な数字 or 疑問文。ただし嘘の数字は禁止）
- 「〜してみた」「〜が便利だった」「〜でハマった」の体験談形式
- 具体的なコマンド・設定・ファイル名を含める
- 改行を多用して読みやすく
- 断定的な「だ・である」調

## 禁止事項
- 嘘の数字（「387%向上」「生産性10倍」等）は絶対に使うな
- 「SES」「フリーランス案件」「単価」の話題は禁止
- FreelanceDBへの誘導は禁止
- AIっぽい定型表現（「〜ではないでしょうか」「〜と言えるでしょう」）は禁止

## ルール
- 記事URLやリンクは含めないでください（投稿時に自動付与）
- ハッシュタグは末尾に2-3個: #ClaudeCode #OpenClaw #AI経営OS から選択
- 絵文字は最小限（冒頭に1個程度はOK）
- 各ポストにhookStyle（question/number/statement/contrast）を設定
- postType: 全て "long_text"（800-1500文字）${hookGuidance}`;

  const userContent = `以下の記事から6種類のXロングポストを生成してください。

タイトル: ${article.title}
要約: ${article.summary}
キーワード: ${article.keywords.slice(0, 5).join(", ")}

## 記事の冒頭部分
${article.body.slice(0, 2000)}

各ポストは800-1500文字の長文で、以下のJSON配列で返してください:
[
  {"type": "teaser", "text": "Claude Code/OpenClawの具体的なTipsを体験談形式で。『Claude Codeで〇〇してみたら〇〇だった』", "postType": "long_text", "hookStyle": "statement", "abVariant": "A"},
  {"type": "teaser", "text": "同じ内容を疑問文フックで。『〇〇の設定、まだデフォルトのまま？』", "postType": "long_text", "hookStyle": "question", "abVariant": "B"},
  {"type": "key-point", "text": "記事の中で最も実践的なコマンドや設定を深掘り。コピペで使える具体例付き", "postType": "long_text", "hookStyle": "statement"},
  {"type": "data-highlight", "text": "実際の作業時間や工数の変化を正直に書く。盛った数字は禁止", "postType": "long_text", "hookStyle": "number"},
  {"type": "discussion", "text": "AI経営OSの構築で学んだ教訓。『9エージェント運用してわかったこと』", "postType": "long_text", "hookStyle": "question"},
  {"type": "quote", "text": "自分の失敗談・ハマりポイント。『最初は〇〇で失敗した。結局〇〇が正解だった』", "postType": "long_text", "hookStyle": "contrast"}
]

JSON配列のみを返してください。`;

  const text = claudeCli(systemPrompt + "\n\n" + userContent);

  let variations: XPostVariation[];
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    try {
      variations = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array found");
      variations = JSON.parse(jsonMatch[0]);
    }
  } catch {
    throw new Error(`Failed to parse X variations: ${text.slice(0, 200)}`);
  }

  // Assign time slots: morning, noon, evening spread across 6 variations
  const slots: Array<"morning" | "noon" | "evening"> = [
    "morning", "morning", "noon", "noon", "evening", "evening",
  ];
  for (let i = 0; i < variations.length; i++) {
    variations[i].scheduledSlot = slots[i % slots.length];
    // Ensure postType defaults
    if (!variations[i].postType) variations[i].postType = "text";
    if (!variations[i].hookStyle) variations[i].hookStyle = "statement";
    // Enforce character limits (without URL — URL is injected at post time)
    const maxLen = variations[i].postType === "long_text" ? 280 : 140;
    if (variations[i].text.length > maxLen) {
      variations[i].text = variations[i].text.slice(0, maxLen - 1) + "…";
    }
  }

  return variations;
}

export function addToXQueue(
  articleTitle: string,
  articleUrl: string,
  variations: XPostVariation[],
): void {
  const queuePath = join(process.cwd(), "data/x-queue.json");

  let queue: XQueue;
  try {
    queue = JSON.parse(readFileSync(queuePath, "utf-8"));
  } catch {
    queue = { entries: [] };
  }

  queue.entries.push({
    articleTitle,
    articleUrl,
    createdAt: new Date().toISOString(),
    variations,
    posted: new Array(variations.length).fill(false),
  });

  writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");
  console.log(`  Added ${variations.length} X post variations to queue`);
}

export function loadXQueue(): XQueue {
  try {
    const queuePath = join(process.cwd(), "data/x-queue.json");
    return JSON.parse(readFileSync(queuePath, "utf-8"));
  } catch {
    return { entries: [] };
  }
}

export function getNextUnpostedVariation(
  slot: "morning" | "noon" | "evening",
): { entry: XQueueEntry; variationIndex: number; variation: XPostVariation } | null {
  const queue = loadXQueue();

  for (const entry of queue.entries) {
    for (let i = 0; i < entry.variations.length; i++) {
      if (!entry.posted[i] && entry.variations[i].scheduledSlot === slot) {
        return { entry, variationIndex: i, variation: entry.variations[i] };
      }
    }
  }
  return null;
}

export function markAsPosted(
  articleTitle: string,
  variationIndex: number,
  tweetId?: string,
): void {
  const queuePath = join(process.cwd(), "data/x-queue.json");
  const queue = loadXQueue();

  const entry = queue.entries.find((e) => e.articleTitle === articleTitle);
  if (entry && variationIndex < entry.posted.length) {
    entry.posted[variationIndex] = true;
    entry.variations[variationIndex].postedAt = new Date().toISOString();
    if (tweetId) {
      entry.variations[variationIndex].tweetId = tweetId;
    }
    writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");
  }
}
