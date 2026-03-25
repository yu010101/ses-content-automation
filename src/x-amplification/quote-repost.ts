/**
 * 引用リポスト戦略: 同ジャンルインフルエンサーの投稿を引用RTして露出を増やす。
 *
 * フロー:
 *   1. quote-targets.json からターゲット選択（priority weighting）
 *   2. Grok API で直近ツイートを検索
 *   3. quote-history.json で引用済みを除外
 *   4. Claude API で引用コメント生成
 *   5. XPublisher.publishQuoteRepost() で投稿
 *   6. 履歴記録
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config.js";
import { XPublisher } from "../publishers/x.js";

// ── Types ────────────────────────────────────────────────

interface QuoteTarget {
  username: string;
  displayName: string;
  priority: "high" | "medium";
}

interface QuoteHistoryEntry {
  quotedTweetId: string;
  targetUsername: string;
  ourTweetId: string;
  commentText: string;
  quotedAt: string;
}

interface QuoteHistory {
  quotes: QuoteHistoryEntry[];
}

interface FoundTweet {
  tweetId: string;
  tweetText: string;
  tweetUrl: string;
}

// ── Data I/O ─────────────────────────────────────────────

const TARGETS_PATH = join(process.cwd(), "data/quote-targets.json");
const HISTORY_PATH = join(process.cwd(), "data/quote-history.json");

function loadTargets(): QuoteTarget[] {
  const data = JSON.parse(readFileSync(TARGETS_PATH, "utf-8"));
  return data.targets;
}

function loadHistory(): QuoteHistory {
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return { quotes: [] };
  }
}

function saveHistory(history: QuoteHistory): void {
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
}

// ── Target selection (weighted by priority) ──────────────

function selectTarget(targets: QuoteTarget[]): QuoteTarget {
  const weighted: QuoteTarget[] = [];
  for (const t of targets) {
    const count = t.priority === "high" ? 3 : 1;
    for (let i = 0; i < count; i++) weighted.push(t);
  }
  return weighted[Math.floor(Math.random() * weighted.length)];
}

// ── Grok: search recent tweets ───────────────────────────

async function searchRecentTweet(
  username: string,
  quotedTweetIds: Set<string>,
): Promise<FoundTweet | null> {
  const client = new OpenAI({
    apiKey: config.xai.apiKey(),
    baseURL: config.xai.baseUrl,
  });

  const response = await client.chat.completions.create({
    model: config.xai.model,
    messages: [
      {
        role: "system",
        content:
          "あなたはX（Twitter）の投稿検索アシスタントです。指定されたアカウントの直近48時間の投稿を検索し、引用リポストに最も適した投稿を1つ選んでください。",
      },
      {
        role: "user",
        content: `以下のXアカウントの直近48時間の投稿を検索し、最も引用リポストに適した投稿を1つ選んでください。

アカウント: @${username}

選定基準:
- エンゲージメント（いいね・RT）が多い投稿を優先
- Claude Code、OpenClaw、AIエージェント、Vibe Coding、AI経営に関連する内容を優先
- リプライや単なるRTではなくオリジナル投稿を優先

JSON形式で返してください: { "tweetId": "...", "tweetText": "...", "tweetUrl": "..." }
JSONのみを返してください。投稿が見つからない場合は null を返してください。`,
      },
    ],
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content || content.trim() === "null") return null;

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed: FoundTweet = JSON.parse(jsonMatch[0]);
    if (!parsed.tweetId || !parsed.tweetText) return null;
    // Skip already quoted
    if (quotedTweetIds.has(parsed.tweetId)) return null;
    return parsed;
  } catch {
    console.warn(`[quote-repost] Failed to parse Grok response for @${username}`);
    return null;
  }
}

// ── Claude: generate quote comment ───────────────────────

async function generateQuoteComment(
  targetUsername: string,
  tweetText: string,
): Promise<string> {
  // Claude CLI経由で生成（AnthropicAPIクレジット不要）
  const { execSync } = await import("node:child_process");
  const prompt = `以下のX投稿に対する引用コメントを生成してください。

@${targetUsername} の投稿:
${tweetText}

ルール:
- AI経営OSを自社構築した経営者の視点で共感+実体験を補足
- 宣伝臭なし（URL、ハッシュタグ、CTA禁止）
- 相手がリポストしたくなる「いい引用」を目指す
- 140字以内
- 絵文字なし
- 自然な日本語、上から目線にならない
- Claude Code、OpenClaw、AIエージェントの実体験があれば触れる

140字以内の引用コメントのみを返してください。余計な説明不要。`;

  try {
    const result = execSync(
      `claude -p ${JSON.stringify(prompt)}`,
      { timeout: 30000, encoding: "utf-8", env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.HOME}/.nvm/versions/node/v22.21.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` } }
    ).trim();
    return result.length > 140 ? result.slice(0, 139) + "…" : result;
  } catch {
    return `これは参考になる。自社でもOpenClawで似た取り組みをしているが、この視点は新しい。`;
  }
}

// ── Main: execute quote repost ───────────────────────────

export async function executeQuoteRepost(dryRun = false): Promise<{
  success: boolean;
  target?: string;
  tweetId?: string;
  comment?: string;
  error?: string;
}> {
  const targets = loadTargets();
  const history = loadHistory();
  const quotedIds = new Set(history.quotes.map((q) => q.quotedTweetId));

  // Try up to 3 different targets
  const tried = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = selectTarget(targets);
    if (tried.has(target.username)) continue;
    tried.add(target.username);

    console.log(`[quote-repost] Searching @${target.username} (${target.displayName})...`);

    const tweet = await searchRecentTweet(target.username, quotedIds);
    if (!tweet) {
      console.log(`[quote-repost] No suitable tweet found for @${target.username}`);
      continue;
    }

    console.log(`[quote-repost] Found tweet: ${tweet.tweetText.slice(0, 80)}...`);

    // Generate comment
    const comment = await generateQuoteComment(target.username, tweet.tweetText);
    console.log(`[quote-repost] Generated comment: ${comment}`);

    if (dryRun) {
      console.log(`[quote-repost] DRY RUN — would quote tweet ${tweet.tweetId}`);
      return {
        success: true,
        target: target.username,
        tweetId: tweet.tweetId,
        comment,
      };
    }

    // Post quote repost
    const publisher = new XPublisher();
    const result = await publisher.publishQuoteRepost(comment, tweet.tweetId);

    if (!result.success) {
      console.error(`[quote-repost] Failed to post: ${result.error}`);
      return { success: false, error: result.error };
    }

    // Save to history
    history.quotes.push({
      quotedTweetId: tweet.tweetId,
      targetUsername: target.username,
      ourTweetId: result.tweetId ?? "",
      commentText: comment,
      quotedAt: new Date().toISOString(),
    });
    saveHistory(history);

    console.log(`[quote-repost] Posted: ${result.url}`);
    return {
      success: true,
      target: target.username,
      tweetId: result.tweetId,
      comment,
    };
  }

  return { success: false, error: "No suitable tweet found after 3 attempts" };
}
