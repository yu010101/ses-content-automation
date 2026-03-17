import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import {
  getArticleType,
  getQiitaArticleType,
  getArticleSystemPrompt,
  X_THREAD_SYSTEM_PROMPT,
  NOTE_REWRITE_SYSTEM_PROMPT,
  ZENN_AI_REWRITE_SYSTEM_PROMPT,
  QIITA_TECH_REWRITE_SYSTEM_PROMPT,
} from "./templates.js";
import type { ArticleType } from "./templates.js";
import type { TrendResult } from "../trends/grok.js";

export interface GeneratedArticle {
  title: string;
  body: string;
  keywords: string[];
  summary: string;
  xPost: string;
  xThread: string[];
  articleType: string;
}

export async function generateArticle(
  trends: TrendResult[],
  keywords: string[],
  marketContext = "",
  learningContext = "",
): Promise<GeneratedArticle> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey() });
  const articleType: ArticleType = getArticleType();

  console.log(`  Article type: ${articleType.name} (${articleType.id})`);

  const trendContext =
    trends.length > 0
      ? trends
          .map(
            (t) =>
              `- ${t.topic}: ${t.summary} (関連度: ${t.relevanceScore.toFixed(2)})`,
          )
          .join("\n")
      : "（トレンド情報なし - キーワードベースで執筆してください）";

  const keywordList = keywords.slice(0, 10).join(", ");

  const systemPrompt = getArticleSystemPrompt(articleType);

  const articleResponse = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `以下のトレンドとキーワードに基づいて、SESエンジニア向けの記事を執筆してください。

## 今日のトレンド
${trendContext}

## ターゲットキーワード（全て記事内に自然に含めること）
${keywordList}
${marketContext ? `\n${marketContext}` : ""}${learningContext ? `\n${learningContext}` : ""}

以下のJSON形式で返してください:
{
  "title": "記事タイトル（SEO最適化、30-50文字）",
  "body": "記事本文（Markdown形式、5000文字以上）",
  "keywords": ["キーワード1", "キーワード2", ...],
  "summary": "記事の要約（200文字以内）"
}

JSONのみを返してください。`,
      },
    ],
  });

  const articleText =
    articleResponse.content[0].type === "text"
      ? articleResponse.content[0].text
      : "";

  let article: Omit<GeneratedArticle, "xPost" | "xThread" | "articleType">;
  try {
    const jsonMatch = articleText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    article = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(
      `Failed to parse article response: ${articleText.slice(0, 200)}`,
    );
  }

  // Generate X thread (3-5 tweets)
  const xResponse = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    system: X_THREAD_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `以下の記事のXスレッドを作成してください:

タイトル: ${article.title}
要約: ${article.summary}
キーワード: ${article.keywords.slice(0, 5).join(", ")}`,
      },
    ],
  });

  const xText =
    xResponse.content[0].type === "text"
      ? xResponse.content[0].text.trim()
      : "";

  // Parse thread JSON
  let xThread: string[] = [];
  let xPost = "";
  try {
    const jsonMatch = xText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      xThread = JSON.parse(jsonMatch[0]);
      xPost = xThread[0] || "";
    }
  } catch {
    // Fallback: use as single tweet
    xPost = xText.slice(0, 280);
    xThread = [xPost];
  }

  return { ...article, xPost, xThread, articleType: articleType.id };
}

export async function generateZennVariation(
  baseArticle: GeneratedArticle,
): Promise<GeneratedArticle> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey() });

  console.log("  Generating Zenn AI-focused article...");

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 8192,
    system: ZENN_AI_REWRITE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `以下のSESエンジニア向け記事をベースに、Zenn向けのAI/技術記事を執筆してください。

## 元記事タイトル
${baseArticle.title}

## 元記事の要約
${baseArticle.summary}

## 元記事のキーワード
${baseArticle.keywords.join(", ")}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in Zenn rewrite response");
    const rewritten = JSON.parse(jsonMatch[0]) as {
      title: string;
      body: string;
      summary: string;
      keywords: string[];
    };

    console.log(`  Zenn title: ${rewritten.title}`);
    console.log(`  Zenn length: ${rewritten.body.length} chars`);

    return {
      ...baseArticle,
      title: rewritten.title,
      body: rewritten.body,
      summary: rewritten.summary,
      keywords: rewritten.keywords || baseArticle.keywords,
      articleType: "zenn-ai",
    };
  } catch {
    console.log("  Zenn AI rewrite failed, falling back to CTA-stripped base");
    // Fallback: strip CTAs from base article
    let body = baseArticle.body;
    body = body.replace(
      /---\s*\n+\*\*.*(?:FreelanceDB|フリーランスDB|キャリアアップ|市場価値|独立|無料登録).*\*\*[\s\S]*$/,
      "",
    );
    body = body.replace(/\[.*?FreelanceDB.*?\]\(.*?\)/g, "");
    body = body.trimEnd();
    body += `\n\n---\n\nこの記事が参考になったら、ぜひLikeしていただけると励みになります。\nAI・機械学習に関する記事を定期的に発信しています。フォローもお待ちしています。`;
    return { ...baseArticle, body };
  }
}

export async function generateQiitaVariation(
  baseArticle: GeneratedArticle,
): Promise<GeneratedArticle> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey() });
  const qiitaType = getQiitaArticleType();

  console.log(`  Generating Qiita tech article (${qiitaType.name})...`);

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 8192,
    system: QIITA_TECH_REWRITE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `以下のSESエンジニア向け記事をベースに、Qiita向けの技術記事を執筆してください。
記事タイプ: ${qiitaType.name}（${qiitaType.id}）

## 元記事タイトル
${baseArticle.title}

## 元記事の要約
${baseArticle.summary}

## 元記事のキーワード
${baseArticle.keywords.join(", ")}

## 追加指示
${qiitaType.systemPrompt}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in Qiita rewrite response");
    const rewritten = JSON.parse(jsonMatch[0]) as {
      title: string;
      body: string;
      summary: string;
      keywords: string[];
    };

    console.log(`  Qiita title: ${rewritten.title}`);
    console.log(`  Qiita length: ${rewritten.body.length} chars`);

    // Verify code blocks exist
    const codeBlockCount = (rewritten.body.match(/```/g) || []).length / 2;
    console.log(`  Qiita code blocks: ${Math.floor(codeBlockCount)}`);

    return {
      ...baseArticle,
      title: rewritten.title,
      body: rewritten.body,
      summary: rewritten.summary,
      keywords: rewritten.keywords || baseArticle.keywords,
      articleType: qiitaType.id,
    };
  } catch {
    console.log("  Qiita tech rewrite failed, using base article");
    return baseArticle;
  }
}

export async function generateNoteVariation(
  baseArticle: GeneratedArticle,
): Promise<GeneratedArticle> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey() });

  console.log("  Generating Note-optimized variation...");

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 8192,
    system: NOTE_REWRITE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `以下の技術記事をnote.com向けにリライトしてください。

## 元記事タイトル
${baseArticle.title}

## 元記事本文
${baseArticle.body}

## キーワード（リライト後も自然に含めること）
${baseArticle.keywords.join(", ")}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in Note rewrite response");
    const rewritten = JSON.parse(jsonMatch[0]) as {
      title: string;
      body: string;
      summary: string;
    };

    console.log(`  Note title: ${rewritten.title}`);
    console.log(`  Note length: ${rewritten.body.length} chars`);

    return {
      ...baseArticle,
      title: rewritten.title,
      body: rewritten.body,
      summary: rewritten.summary,
    };
  } catch {
    console.log("  Note rewrite failed, using base article");
    return baseArticle;
  }
}
