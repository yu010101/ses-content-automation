import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
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
  hookStyle: string,
): string {
  const utm = new URLSearchParams({
    utm_source: "x",
    utm_campaign: "variation",
    utm_content: hookStyle,
  });
  const ctaUrl = `${config.freelanceDbUrl}?${utm.toString()}`;
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
  const client = new Anthropic({ apiKey: config.anthropic.apiKey() });

  // Load learning state for hookStyle weighting
  const learningState = loadLearningState();
  const bestHooks = learningState?.bestHookStyles ?? [];
  const hookGuidance = bestHooks.length > 0
    ? `\n\n過去データから効果的なhookStyle: ${bestHooks.join(", ")}。これらを70%の確率で使用してください。`
    : "";

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    system: `あなたはSES業界データメディア「SES Core」のX運用担当です。
1つの記事から6種類の異なるXポストを作成してください。

ルール:
- 記事URLやリンクは含めないでください（投稿時に自動付与します）
- ハッシュタグは teaser A にのみ #SES #フリーランスエンジニア
- 絵文字は使わない
- データに基づいた説得力のあるトーン
- 各ポストにhookStyle（question/number/statement/contrast）を設定
  - question: 問いかけで始まる
  - number: 数字・データで始まる
  - statement: 断定的な主張で始まる
  - contrast: 対比構造（○○なのに××）
- postType: "text"（140字以内）または "long_text"（280字以内）${hookGuidance}`,
    messages: [
      {
        role: "user",
        content: `以下の記事から6種類のXポストを生成してください。

タイトル: ${article.title}
要約: ${article.summary}
キーワード: ${article.keywords.slice(0, 5).join(", ")}

## 記事の冒頭部分
${article.body.slice(0, 1500)}

以下のJSON配列で返してください:
[
  {"type": "teaser", "text": "インパクトある数字+続きが気になる一言", "postType": "text", "hookStyle": "number", "abVariant": "A"},
  {"type": "teaser", "text": "同じ内容を別の切り口で（A/Bテスト用）", "postType": "text", "hookStyle": "question", "abVariant": "B"},
  {"type": "key-point", "text": "1つの具体的アクション", "postType": "text", "hookStyle": "statement"},
  {"type": "data-highlight", "text": "驚きのデータポイント", "postType": "long_text", "hookStyle": "number"},
  {"type": "discussion", "text": "記事トピックに関連する問いかけ", "postType": "text", "hookStyle": "question"},
  {"type": "quote", "text": "記事から引用した強い一文+考察", "postType": "long_text", "hookStyle": "contrast"}
]

JSON配列のみを返してください。`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  let variations: XPostVariation[];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    variations = JSON.parse(jsonMatch[0]);
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
