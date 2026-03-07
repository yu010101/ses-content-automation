import crypto from "node:crypto";
import { config } from "../config.js";
import { formatForX } from "../content/formatter.js";
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
      console.log(`[X] DRY RUN - Would tweet: "${text}"`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

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
