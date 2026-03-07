import crypto from "node:crypto";
import { config } from "../config.js";
import { formatForX } from "../content/formatter.js";
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

export class XPublisher implements IPublisher {
  platform = "x";

  async publish(
    article: GeneratedArticle,
    dryRun = false,
    articleUrl?: string,
  ): Promise<PublishResult> {
    const text = formatForX(article, articleUrl);

    if (dryRun) {
      console.log(`[X] DRY RUN - Would tweet: "${text}\n(dry-run)"`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    // Try MCP (note-com-mcp) first
    if (await isMcpAvailable()) {
      return this.publishViaMcp(text);
    }

    // Fallback to direct OAuth
    return this.publishViaOAuth(text);
  }

  private async publishViaMcp(text: string): Promise<PublishResult> {
    try {
      console.log("[X] Publishing via MCP (note-com-mcp)...");
      const result = await mcpCall("cross-post", {
        platform: "twitter",
        text,
      }) as { content?: Array<{ text?: string }>; isError?: boolean };
      const resultText = JSON.stringify(result).slice(0, 300);
      console.log(`[X] MCP result:`, resultText);
      if (result?.isError || resultText.includes("失敗")) {
        return { platform: this.platform, success: false, error: `MCP: ${resultText}` };
      }
      return { platform: this.platform, success: true, url: "(via-mcp)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[X] MCP failed: ${message}, trying OAuth...`);
      return this.publishViaOAuth(text);
    }
  }

  private async publishViaOAuth(text: string): Promise<PublishResult> {
    const url = "https://api.twitter.com/2/tweets";
    const body = JSON.stringify({ text });
    const authHeader = generateOAuthHeader("POST", url, {});

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body,
    });

    if (!res.ok) {
      const err = await res.text();
      return { platform: this.platform, success: false, error: `${res.status}: ${err}` };
    }

    const data = (await res.json()) as { data: { id: string } };
    const tweetUrl = `https://x.com/i/status/${data.data.id}`;
    console.log(`[X] Published: ${tweetUrl}`);
    return { platform: this.platform, success: true, url: tweetUrl };
  }
}
