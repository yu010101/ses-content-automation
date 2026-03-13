import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import {
  getArticleType,
  getArticleSystemPrompt,
  X_THREAD_SYSTEM_PROMPT,
  NOTE_REWRITE_SYSTEM_PROMPT,
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
${marketContext ? `\n${marketContext}` : ""}

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

export function generateZennVariation(
  baseArticle: GeneratedArticle,
): GeneratedArticle {
  console.log("  Generating Zenn CTA-free variation...");

  let body = baseArticle.body;

  // Remove CTA sections (--- followed by promotional block at end)
  body = body.replace(
    /---\s*\n+\*\*.*(?:FreelanceDB|フリーランスDB|キャリアアップ|市場価値|独立|無料登録).*\*\*[\s\S]*$/,
    "",
  );

  // Remove any remaining FreelanceDB links and registration CTAs
  body = body.replace(/\[.*?FreelanceDB.*?\]\(.*?\)/g, "");
  body = body.replace(/FreelanceDB\s*(?:に|で|なら|では)[\s\S]*?(?:登録|始めましょう|見つ[けか]る).*$/gm, "");

  // Trim trailing whitespace/newlines
  body = body.trimEnd();

  // Add a Zenn-friendly closing
  body += `

---

この記事が参考になったら、ぜひLikeしていただけると励みになります。
SESエンジニアのキャリアに関する記事を定期的に発信しています。フォローもお待ちしています。`;

  console.log(`  Zenn variation length: ${body.length} chars`);

  return {
    ...baseArticle,
    body,
  };
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
