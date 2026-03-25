import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const text = readFileSync("/tmp/x-longpost.txt", "utf-8").trim();

const consumerKey = process.env.X_CONSUMER_KEY!;
const consumerSecret = process.env.X_CONSUMER_SECRET!;
const accessToken = process.env.X_ACCESS_TOKEN!;
const accessSecret = process.env.X_ACCESS_SECRET!;

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function post() {
  const method = "POST";
  const url = "https://api.twitter.com/2/tweets";
  const body = JSON.stringify({ text });

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
    .join("&");

  const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(accessSecret)}`;
  const signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");
  oauthParams["oauth_signature"] = signature;

  const authHeader =
    "OAuth " +
    Object.entries(oauthParams)
      .map(([k, v]) => `${k}="${percentEncode(v)}"`)
      .join(", ");

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body,
  });

  const data = await resp.json();
  if (data.data) {
    console.log(`✅ Posted: https://x.com/i/status/${data.data.id}`);
    console.log(`Length: ${text.length} chars`);
  } else {
    console.log(`❌ Error: ${JSON.stringify(data)}`);
  }
}

post().catch(console.error);
