import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import type { GeneratedArticle } from "../content/generator.js";

export interface XPostVariation {
  type: "teaser" | "key-point" | "data-highlight" | "discussion" | "quote";
  text: string;
  scheduledSlot?: "morning" | "noon" | "evening";
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

export async function generateXVariations(
  article: GeneratedArticle,
  articleUrl: string,
): Promise<XPostVariation[]> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey() });

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    system: `あなたはSES業界データメディア「SES Core」のX運用担当です。
1つの記事から5種類の異なるXポストを作成してください。

ルール:
- 各ポストは140文字以内（日本語）
- 記事URLは含めないでください（後から自動付与します）
- ハッシュタグは1つ目のポストにのみ #SES #フリーランスエンジニア
- 絵文字は使わない
- データに基づいた説得力のあるトーン`,
    messages: [
      {
        role: "user",
        content: `以下の記事から5種類のXポストを生成してください。

タイトル: ${article.title}
要約: ${article.summary}
キーワード: ${article.keywords.slice(0, 5).join(", ")}

## 記事の冒頭部分
${article.body.slice(0, 1500)}

以下のJSON配列で返してください:
[
  {"type": "teaser", "text": "記事の最もインパクトある数字やファクト + 続きが気になる一言"},
  {"type": "key-point", "text": "1つの具体的アクション"},
  {"type": "data-highlight", "text": "驚きのデータポイント"},
  {"type": "discussion", "text": "記事トピックに関連する問いかけ"},
  {"type": "quote", "text": "記事から引用した強い一文"}
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

  // Assign time slots: morning, noon, evening spread + extras
  const slots: Array<"morning" | "noon" | "evening"> = ["morning", "noon", "evening", "morning", "noon"];
  for (let i = 0; i < variations.length; i++) {
    variations[i].scheduledSlot = slots[i % slots.length];
    // Append article URL to each variation
    const maxLen = 140 - 1; // Leave room for newline
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

export function markAsPosted(articleTitle: string, variationIndex: number): void {
  const queuePath = join(process.cwd(), "data/x-queue.json");
  const queue = loadXQueue();

  const entry = queue.entries.find((e) => e.articleTitle === articleTitle);
  if (entry && variationIndex < entry.posted.length) {
    entry.posted[variationIndex] = true;
    writeFileSync(queuePath, JSON.stringify(queue, null, 2), "utf-8");
  }
}
