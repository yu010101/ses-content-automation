/**
 * X長文投稿 + AI生成サマリー画像付き
 *
 * Usage:
 *   npx tsx scripts/post-to-x-with-image.ts [topic]
 *   npx tsx scripts/post-to-x-with-image.ts "Claude Codeで経営OSを作った話"
 */

import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";
import Anthropic from "@anthropic-ai/sdk";

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

function oauthHeader(method: string, url: string, params: Record<string, string> = {}): string {
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
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");
  oauthParams["oauth_signature"] = signature;

  return "OAuth " + Object.entries(oauthParams)
    .map(([k, v]) => `${k}="${percentEncode(v)}"`)
    .join(", ");
}

// Step 1: Generate post text + image data via Claude
async function generatePost(topic: string): Promise<{ text: string; imageHtml: string; title: string; keyPoints: string[] }> {
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: "claude-fable-5",
    max_tokens: 4096,
    messages: [{
      role: "user",
      content: `以下のテーマでX長文投稿を作成してください。

テーマ: ${topic}

## 出力形式（JSON）
{
  "text": "投稿本文（1500-2500文字、だ・である調、断定的、データ駆動、改行多用）",
  "title": "画像に表示するタイトル（30文字以内、インパクトある1行）",
  "keyPoints": ["要点1（20文字以内）", "要点2", "要点3", "要点4"],
  "hashtags": "#ハッシュタグ1 #ハッシュタグ2"
}

## スタイルルール
- 星野ロミ(@romi_hoshino)のデータ駆動型: 具体的な数字で常識を覆す
- AI駆動塾(@L_go_mrk)の独断的主張: 断定的で挑発的
- 冒頭で衝撃的な数字や主張で引き込む
- 「SES」は前面に出さない。AI/開発/エンジニア全般に訴求
- FreelanceDBへの宣伝は入れない

JSONのみを返してください。`
    }]
  });

  const raw = resp.content[0].type === "text" ? resp.content[0].text : "";
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  const data = JSON.parse(cleaned);

  const imageHtml = generateImageHtml(data.title, data.keyPoints);
  return { text: data.text + "\n\n" + data.hashtags, imageHtml, title: data.title, keyPoints: data.keyPoints };
}

// Step 2: Generate OGP-style summary image via HTML+Playwright
function generateImageHtml(title: string, keyPoints: string[]): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 675px; font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif; }
  .card {
    width: 1200px; height: 675px;
    background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%);
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    padding: 60px 80px; position: relative; overflow: hidden;
  }
  .card::before {
    content: ''; position: absolute; top: -50%; left: -50%;
    width: 200%; height: 200%;
    background: radial-gradient(circle at 30% 40%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
                radial-gradient(circle at 70% 60%, rgba(139, 92, 246, 0.1) 0%, transparent 50%);
  }
  .title {
    font-size: 52px; font-weight: 900; color: #fff;
    text-align: center; line-height: 1.3; z-index: 1;
    text-shadow: 0 2px 20px rgba(59, 130, 246, 0.3);
    margin-bottom: 40px;
  }
  .points {
    display: grid; grid-template-columns: 1fr 1fr; gap: 16px 40px;
    z-index: 1; width: 100%;
  }
  .point {
    display: flex; align-items: center; gap: 12px;
    background: rgba(255,255,255,0.08); border-radius: 12px;
    padding: 16px 24px; border: 1px solid rgba(255,255,255,0.1);
  }
  .point-icon {
    width: 36px; height: 36px; border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 900; font-size: 18px; flex-shrink: 0;
  }
  .point-text { color: #e2e8f0; font-size: 22px; font-weight: 600; }
  .footer {
    position: absolute; bottom: 24px; right: 40px;
    color: rgba(255,255,255,0.4); font-size: 16px; z-index: 1;
  }
  .accent-line {
    position: absolute; top: 0; left: 0; right: 0; height: 4px;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
  }
</style></head>
<body><div class="card">
  <div class="accent-line"></div>
  <div class="title">${title}</div>
  <div class="points">
    ${keyPoints.map((p, i) => `<div class="point"><div class="point-icon">${i + 1}</div><div class="point-text">${p}</div></div>`).join("\n    ")}
  </div>
  <div class="footer">@web3master555</div>
</div></body></html>`;
}

async function captureImage(html: string, outputPath: string): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  await page.setContent(html);
  await page.screenshot({ path: outputPath, type: "png" });
  await browser.close();
}

// Step 3: Upload image to X
async function uploadMedia(imagePath: string): Promise<string> {
  const imageData = readFileSync(imagePath);
  const base64 = imageData.toString("base64");

  const uploadUrl = "https://upload.twitter.com/1.1/media/upload.json";
  const auth = oauthHeader("POST", uploadUrl);

  const formData = new FormData();
  formData.append("media_data", base64);

  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: auth },
    body: formData,
  });

  const data = await resp.json();
  if (data.media_id_string) {
    console.log(`📸 Image uploaded: media_id=${data.media_id_string}`);
    return data.media_id_string;
  }
  throw new Error(`Upload failed: ${JSON.stringify(data)}`);
}

// Step 4: Post tweet with media
async function postTweet(text: string, mediaId?: string): Promise<void> {
  const url = "https://api.twitter.com/2/tweets";
  const body: any = { text };
  if (mediaId) {
    body.media = { media_ids: [mediaId] };
  }

  const auth = oauthHeader("POST", url);
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (data.data) {
    console.log(`✅ Posted: https://x.com/i/status/${data.data.id}`);
    console.log(`📝 Length: ${text.length} chars`);
  } else {
    console.log(`❌ Error: ${JSON.stringify(data)}`);
  }
}

// Main
async function main() {
  const topic = process.argv[2] || "2026年にエンジニアがAIツールを使いこなせないと淘汰される理由";

  console.log(`🚀 Generating post for: ${topic}`);

  // Generate text + image data
  const { text, imageHtml, title, keyPoints } = await generatePost(topic);
  console.log(`📝 Text: ${text.length} chars`);
  console.log(`🎨 Title: ${title}`);
  console.log(`📌 Points: ${keyPoints.join(" / ")}`);

  // Capture image
  const imagePath = "/tmp/x-post-image.png";
  await captureImage(imageHtml, imagePath);
  console.log(`📸 Image saved: ${imagePath}`);

  // Upload image
  let mediaId: string | undefined;
  try {
    mediaId = await uploadMedia(imagePath);
  } catch (err) {
    console.log(`⚠️ Image upload failed: ${err}, posting without image`);
  }

  // Post
  await postTweet(text, mediaId);
}

main().catch(console.error);
