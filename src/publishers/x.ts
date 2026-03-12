import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { isMcpAvailable, mcpCall } from "./mcp-client.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function generateOAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const consumerKey = config.x.consumerKey();
  const consumerSecret = config.x.consumerSecret();
  const accessToken = config.x.accessToken();
  const accessSecret = config.x.accessSecret();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const allParams = { ...oauthParams, ...params };
  const paramString = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  oauthParams["oauth_signature"] = signature;

  const header = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return `OAuth ${header}`;
}

// Free tier: 1,500 tweets/month. Single tweet saves credits vs threads.
const X_MONTHLY_LIMIT = 1500;
const X_BUDGET_FILE = "data/x-budget.json";

interface XBudget {
  month: string; // "2026-03"
  used: number;
}

function getXBudget(): XBudget {
  try {
    const data: XBudget = JSON.parse(
      readFileSync(join(process.cwd(), X_BUDGET_FILE), "utf-8"),
    );
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (data.month !== currentMonth) return { month: currentMonth, used: 0 };
    return data;
  } catch {
    return { month: new Date().toISOString().slice(0, 7), used: 0 };
  }
}

function saveXBudget(budget: XBudget): void {
  writeFileSync(
    join(process.cwd(), X_BUDGET_FILE),
    JSON.stringify(budget, null, 2),
    "utf-8",
  );
}

export class XPublisher implements IPublisher {
  platform = "x";

  async publish(
    article: GeneratedArticle,
    dryRun = false,
    articleUrl?: string,
  ): Promise<PublishResult> {
    // Budget check: conserve credits on free tier
    const budget = getXBudget();
    const thread = this.buildThread(article, articleUrl);
    const tweetsNeeded = thread.length;

    if (budget.used + tweetsNeeded > X_MONTHLY_LIMIT && !dryRun) {
      console.log(
        `[X] Skipping: monthly budget exhausted (${budget.used}/${X_MONTHLY_LIMIT} used)`,
      );
      return {
        platform: this.platform,
        success: true,
        url: "(skipped-budget-limit)",
      };
    }

    // If budget is tight (>80%), fall back to single tweet to conserve
    if (budget.used > X_MONTHLY_LIMIT * 0.8 && thread.length > 1 && !dryRun) {
      console.log(
        `[X] Budget tight (${budget.used}/${X_MONTHLY_LIMIT}), posting single tweet instead of thread`,
      );
      thread.splice(1); // Keep only first tweet
    }

    if (dryRun) {
      console.log(`[X] DRY RUN - Thread (${thread.length} tweets):`);
      thread.forEach((t, i) => console.log(`  [${i + 1}] ${t}`));
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    // Try MCP first (single tweet only)
    if (await isMcpAvailable()) {
      const mcpResult = await this.publishViaMcp(thread[0]);
      if (mcpResult.success) {
        budget.used += 1;
        saveXBudget(budget);
        return mcpResult;
      }
    }

    // Direct OAuth: post thread
    const result = await this.publishThread(thread);
    if (result.success) {
      budget.used += thread.length;
      saveXBudget(budget);
    }
    return result;
  }

  private buildThread(article: GeneratedArticle, articleUrl?: string): string[] {
    if (article.xThread && article.xThread.length > 1) {
      const thread = [...article.xThread];
      // Append article URL to the last tweet
      if (articleUrl) {
        const last = thread.length - 1;
        thread[last] = `${thread[last]}\n${articleUrl}`;
      }
      return thread;
    }

    // Fallback: single tweet
    let post = article.xPost;
    if (articleUrl) {
      const maxLen = 280 - articleUrl.length - 2;
      if (post.length > maxLen) {
        post = post.slice(0, maxLen - 1) + "…";
      }
      post = `${post}\n${articleUrl}`;
    }
    return [post];
  }

  private async publishViaMcp(text: string): Promise<PublishResult> {
    try {
      console.log("[X] Publishing via MCP (note-com-mcp)...");
      const result = (await mcpCall("cross-post", {
        platform: "twitter",
        text,
      })) as { content?: Array<{ text?: string }>; isError?: boolean };
      const resultText = JSON.stringify(result).slice(0, 300);
      console.log(`[X] MCP result:`, resultText);
      if (result?.isError || resultText.includes("失敗")) {
        console.log(`[X] MCP failed, trying direct OAuth...`);
        return { platform: this.platform, success: false, error: "MCP failed" };
      }
      return { platform: this.platform, success: true, url: "(via-mcp)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[X] MCP failed: ${message}, trying OAuth...`);
      return { platform: this.platform, success: false, error: message };
    }
  }

  private async publishThread(thread: string[]): Promise<PublishResult> {
    let previousTweetId: string | undefined;
    let firstTweetUrl = "";

    for (let i = 0; i < thread.length; i++) {
      const tweetBody: Record<string, unknown> = { text: thread[i] };
      if (previousTweetId) {
        tweetBody.reply = { in_reply_to_tweet_id: previousTweetId };
      }

      const url = "https://api.twitter.com/2/tweets";
      const authHeader = generateOAuthHeader("POST", url, {});

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify(tweetBody),
      });

      if (!res.ok) {
        const err = await res.text();
        const posted = i > 0 ? ` (${i}/${thread.length} tweets posted)` : "";
        return {
          platform: this.platform,
          success: false,
          error: `${res.status}: ${err}${posted}`,
        };
      }

      const data = (await res.json()) as { data: { id: string } };
      previousTweetId = data.data.id;

      if (i === 0) {
        firstTweetUrl = `https://x.com/i/status/${data.data.id}`;
      }

      console.log(`[X] Tweet ${i + 1}/${thread.length} posted`);
    }

    console.log(`[X] Thread published: ${firstTweetUrl}`);
    return { platform: this.platform, success: true, url: firstTweetUrl };
  }
}
