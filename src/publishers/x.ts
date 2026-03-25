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

/** Mark local budget as fully exhausted so future calls skip without hitting the API. */
function markBudgetExhausted(): void {
  const budget = getXBudget();
  budget.used = X_MONTHLY_LIMIT;
  saveXBudget(budget);
  console.log(
    `[X] Budget synced to exhausted (${X_MONTHLY_LIMIT}/${X_MONTHLY_LIMIT}) — server returned 402 CreditsDepleted`,
  );
}

/** Parse API error responses and handle 401/402 specially. Returns a PublishResult on handled errors, or null to use default handling. */
function handleApiError(
  status: number,
  body: string,
  platform: string,
  context: string,
): PublishResult | null {
  if (status === 402) {
    markBudgetExhausted();
    console.log(
      `[X] 402 CreditsDepleted during ${context}. Local budget synced. All further X posts will be skipped this month.`,
    );
    return { platform, success: false, error: `402 CreditsDepleted: X API free tier credits exhausted server-side. Local budget synced.` };
  }
  if (status === 401) {
    console.log(
      `[X] 401 Unauthorized during ${context}. Check your X API keys: X_CONSUMER_KEY, X_CONSUMER_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET. They may be expired or revoked.`,
    );
    return { platform, success: false, error: `401 Unauthorized: Check X API credentials (consumer key/secret, access token/secret). Keys may be expired or revoked.` };
  }
  return null;
}

export class XPublisher implements IPublisher {
  platform = "x";

  /** Returns false if the monthly X budget is exhausted (local tracker). */
  static checkBudgetAvailable(): boolean {
    const budget = getXBudget();
    return budget.used < X_MONTHLY_LIMIT;
  }

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
    // Long-form single post strategy (AI駆動塾 style)
    // Combine thread into one long post, or use xPost directly
    let longPost: string;

    if (article.xThread && article.xThread.length > 1) {
      // Merge thread into single long-form post
      longPost = article.xThread.join("\n\n");
    } else {
      longPost = article.xPost;
    }

    // Append article URL
    if (articleUrl) {
      longPost = `${longPost}\n\n詳しくはこちら👇\n${articleUrl}`;
    }

    // X Premium allows up to 25,000 chars; free tier is 280
    // For long-form, keep under 4000 chars to be safe
    if (longPost.length > 4000) {
      longPost = longPost.slice(0, 3950) + "…";
      if (articleUrl) {
        longPost += `\n${articleUrl}`;
      }
    }

    return [longPost];
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

  async publishSingle(
    text: string,
    postType: "text" | "long_text" = "text",
    dryRun = false,
  ): Promise<PublishResult> {
    const budget = getXBudget();
    if (budget.used + 1 > X_MONTHLY_LIMIT && !dryRun) {
      console.log(`[X] Skipping: monthly budget exhausted (${budget.used}/${X_MONTHLY_LIMIT})`);
      return { platform: this.platform, success: false, error: "budget-exhausted" };
    }

    // Enforce character limits
    const limit = postType === "long_text" ? 25000 : 280;
    if (text.length > limit) {
      console.log(`[X] Text exceeds ${limit} chars (${text.length}), truncating`);
      text = text.slice(0, limit - 1) + "…";
    }

    if (dryRun) {
      console.log(`[X] DRY RUN (${postType}): ${text}`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    const url = "https://api.twitter.com/2/tweets";
    const authHeader = generateOAuthHeader("POST", url, {});

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const err = await res.text();
      const handled = handleApiError(res.status, err, this.platform, "publishSingle");
      if (handled) return handled;
      return { platform: this.platform, success: false, error: `${res.status}: ${err}` };
    }

    const data = (await res.json()) as { data: { id: string } };
    const tweetId = data.data.id;
    const tweetUrl = `https://x.com/i/status/${tweetId}`;

    budget.used += 1;
    saveXBudget(budget);

    console.log(`[X] Posted (${postType}): ${tweetUrl}`);
    return { platform: this.platform, success: true, url: tweetUrl, tweetId };
  }

  async publishQuoteRepost(
    text: string,
    quoteTweetId: string,
    dryRun = false,
  ): Promise<PublishResult> {
    const budget = getXBudget();
    if (budget.used + 1 > X_MONTHLY_LIMIT && !dryRun) {
      console.log(`[X] Skipping quote: monthly budget exhausted (${budget.used}/${X_MONTHLY_LIMIT})`);
      return { platform: this.platform, success: false, error: "budget-exhausted" };
    }

    if (text.length > 280) {
      text = text.slice(0, 279) + "…";
    }

    if (dryRun) {
      console.log(`[X] DRY RUN (quote-repost): ${text} | quote=${quoteTweetId}`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    const url = "https://api.twitter.com/2/tweets";
    const authHeader = generateOAuthHeader("POST", url, {});

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ text, quote_tweet_id: quoteTweetId }),
    });

    if (!res.ok) {
      const err = await res.text();
      const handled = handleApiError(res.status, err, this.platform, "publishQuoteRepost");
      if (handled) return handled;
      return { platform: this.platform, success: false, error: `${res.status}: ${err}` };
    }

    const data = (await res.json()) as { data: { id: string } };
    const tweetId = data.data.id;
    const tweetUrl = `https://x.com/i/status/${tweetId}`;

    budget.used += 1;
    saveXBudget(budget);

    console.log(`[X] Quote repost posted: ${tweetUrl}`);
    return { platform: this.platform, success: true, url: tweetUrl, tweetId };
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
        const handled = handleApiError(res.status, err, this.platform, `publishThread[${i + 1}/${thread.length}]`);
        if (handled) {
          const posted = i > 0 ? ` (${i}/${thread.length} tweets posted before failure)` : "";
          handled.error = `${handled.error}${posted}`;
          return handled;
        }
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
