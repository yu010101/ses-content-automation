import OpenAI from "openai";
import { config } from "../config.js";
import { claudeCli } from "../utils/claude-cli.js";
import {
  getArticleType,
  getQiitaArticleType,
  getArticleSystemPrompt,
  ROUNDUP_ARTICLE_TYPE,
  ROUNDUP_ZENN_REWRITE_SYSTEM_PROMPT,
  ROUNDUP_QIITA_REWRITE_SYSTEM_PROMPT,
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

  const userContent = `以下のトレンドとキーワードに基づいて、SESエンジニア向けの記事を執筆してください。

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

JSONのみを返してください。`;

  const articleText = claudeCli(systemPrompt + "\n\n" + userContent);

  let article: Omit<GeneratedArticle, "xPost" | "xThread" | "articleType">;
  try {
    // Strip markdown code fences if present
    let cleaned = articleText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    // Try direct parse first, then regex fallback
    try {
      article = JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      article = JSON.parse(jsonMatch[0]);
    }
  } catch {
    throw new Error(
      `Failed to parse article response: ${articleText.slice(0, 200)}`,
    );
  }

  // Generate X thread (3-5 tweets)
  const xText = claudeCli(X_THREAD_SYSTEM_PROMPT + "\n\n" + `以下の記事のXスレッドを作成してください:

タイトル: ${article.title}
要約: ${article.summary}
キーワード: ${article.keywords.slice(0, 5).join(", ")}`);

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
  console.log("  Generating Zenn AI-focused article...");

  const text = claudeCli(ZENN_AI_REWRITE_SYSTEM_PROMPT + "\n\n" + `以下のSESエンジニア向け記事をベースに、Zenn向けのAI/技術記事を執筆してください。

## 元記事タイトル
${baseArticle.title}

## 元記事の要約
${baseArticle.summary}

## 元記事のキーワード
${baseArticle.keywords.join(", ")}`);

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
  const qiitaType = getQiitaArticleType();

  console.log(`  Generating Qiita tech article (${qiitaType.name})...`);

  const text = claudeCli(QIITA_TECH_REWRITE_SYSTEM_PROMPT + "\n\n" + `以下のSESエンジニア向け記事をベースに、Qiita向けの技術記事を執筆してください。
記事タイプ: ${qiitaType.name}（${qiitaType.id}）

## 元記事タイトル
${baseArticle.title}

## 元記事の要約
${baseArticle.summary}

## 元記事のキーワード
${baseArticle.keywords.join(", ")}

## 追加指示
${qiitaType.systemPrompt}`);

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
  console.log("  Generating Note-optimized variation...");

  const text = claudeCli(NOTE_REWRITE_SYSTEM_PROMPT + "\n\n" + `以下の技術記事をnote.com向けにリライトしてください。

## 元記事タイトル
${baseArticle.title}

## 元記事本文
${baseArticle.body}

## キーワード（リライト後も自然に含めること）
${baseArticle.keywords.join(", ")}`);

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

// --- Roundup Article Generation (Grok research → Claude generation) ---

export interface RoundupSeed {
  category: string;
  title_hint: string;
  items: string[];
  qiita_tags: string[];
}

export async function generateRoundupArticle(
  seed: RoundupSeed,
  marketContext = "",
): Promise<GeneratedArticle> {
  const grok = new OpenAI({
    apiKey: config.xai.apiKey(),
    baseURL: config.xai.baseUrl,
  });

  // Step 1: Grok research — gather latest info on each tool
  console.log("  [Roundup] Researching tools via Grok...");
  const researchResults: string[] = [];

  for (const item of seed.items) {
    try {
      const response = await grok.chat.completions.create({
        model: config.xai.model,
        messages: [
          {
            role: "system",
            content:
              "あなたはAI/開発ツールのリサーチアナリストです。X上の最新投稿や公開情報から、指定されたツールの最新状況を調査してください。",
          },
          {
            role: "user",
            content: `「${item}」について以下を調査し、簡潔にまとめてください:
- 最新バージョン・アップデート情報
- X上での評判・ユーザーの声
- GitHub Star数（分かれば）
- 主な特徴と強み/弱み
- 料金プラン（無料/有料の区分）

300文字程度で簡潔に日本語でまとめてください。`,
          },
        ],
        temperature: 0.5,
      });
      const content = response.choices[0]?.message?.content;
      if (content) {
        researchResults.push(`### ${item}\n${content}`);
      }
    } catch (err) {
      console.log(
        `  [Roundup] Grok research failed for ${item}: ${err instanceof Error ? err.message : err}`,
      );
      researchResults.push(`### ${item}\n（リサーチ情報取得失敗）`);
    }
  }

  const researchContext = researchResults.join("\n\n");
  console.log(
    `  [Roundup] Research complete: ${researchResults.length}/${seed.items.length} tools`,
  );

  // Step 2: Claude article generation (with retry if under 8000 chars)
  console.log("  [Roundup] Generating article via Claude...");
  const systemPrompt = getArticleSystemPrompt(ROUNDUP_ARTICLE_TYPE);

  const MAX_ATTEMPTS = 2;
  let article: Omit<GeneratedArticle, "xPost" | "xThread" | "articleType"> | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const extraInstruction = attempt > 1
      ? "\n\n⚠️ 前回の生成が8000文字未満でした。各ツールの解説をより詳しく、コード例もより実践的に、8000文字以上を厳守してください。"
      : "";

    const roundupUserContent = `「${seed.title_hint}」の総まとめ記事を執筆してください。

## 対象ツール
${seed.items.join(", ")}

## リサーチ結果（Grok APIによる最新情報）
${researchContext}
${marketContext ? `\n## 市場データ\n${marketContext}` : ""}${extraInstruction}

以下のJSON形式で返してください:
{
  "title": "記事タイトル（SEO最適化、「【2026年最新】」を含む、30-60文字）",
  "body": "記事本文（Markdown形式、8000文字以上、Tier分類+比較テーブル+コード例必須）",
  "keywords": ["キーワード1", "キーワード2", ...],
  "summary": "記事の要約（200文字以内）"
}

JSONのみを返してください。`;

    const articleText = claudeCli(systemPrompt + "\n\n" + roundupUserContent);

    try {
      const jsonMatch = articleText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in roundup response");
      article = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.log(`  [Roundup] Parse failed (attempt ${attempt}): ${err instanceof Error ? err.message : err}`);
      if (attempt < MAX_ATTEMPTS) continue;
      throw new Error(
        `Failed to parse roundup article response after ${MAX_ATTEMPTS} attempts`,
      );
    }

    const charCount = article!.body.length;
    if (charCount >= 8000) {
      console.log(`  [Roundup] Article: ${charCount} chars (attempt ${attempt}) ✓`);
      break;
    }

    if (attempt < MAX_ATTEMPTS) {
      console.log(`  [Roundup] Article: ${charCount} chars < 8000, retrying...`);
    } else {
      console.log(`  [Roundup] Article: ${charCount} chars (below target, proceeding)`);
    }
  }

  if (!article) throw new Error("Failed to generate roundup article");

  // Generate X thread
  const xText = claudeCli(X_THREAD_SYSTEM_PROMPT + "\n\n" + `以下の記事のXスレッドを作成してください:

タイトル: ${article.title}
要約: ${article.summary}
キーワード: ${article.keywords.slice(0, 5).join(", ")}`);

  let xThread: string[] = [];
  let xPost = "";
  try {
    const jsonMatch = xText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      xThread = JSON.parse(jsonMatch[0]);
      xPost = xThread[0] || "";
    }
  } catch {
    xPost = xText.slice(0, 280);
    xThread = [xPost];
  }

  return { ...article, xPost, xThread, articleType: "roundup" };
}

export async function generateRoundupZennVariation(
  baseArticle: GeneratedArticle,
): Promise<GeneratedArticle> {
  console.log("  Generating Zenn roundup variation...");

  const text = claudeCli(ROUNDUP_ZENN_REWRITE_SYSTEM_PROMPT + "\n\n" + `以下のAI/ツールまとめ記事をZenn向けに書き直してください。

## 元記事タイトル
${baseArticle.title}

## 元記事本文
${baseArticle.body}

## キーワード
${baseArticle.keywords.join(", ")}`);

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in Zenn roundup rewrite");
    const rewritten = JSON.parse(jsonMatch[0]) as {
      title: string;
      body: string;
      summary: string;
      keywords: string[];
    };

    console.log(`  Zenn roundup title: ${rewritten.title}`);
    console.log(`  Zenn roundup length: ${rewritten.body.length} chars`);

    return {
      ...baseArticle,
      title: rewritten.title,
      body: rewritten.body,
      summary: rewritten.summary,
      keywords: rewritten.keywords || baseArticle.keywords,
      articleType: "roundup-zenn",
    };
  } catch {
    console.log("  Zenn roundup rewrite failed, using CTA-stripped base");
    let body = baseArticle.body;
    body = body.replace(
      /---\s*\n+\*\*.*(?:FreelanceDB|フリーランスDB|キャリアアップ|市場価値|独立|無料登録).*\*\*[\s\S]*$/,
      "",
    );
    body = body.replace(/\[.*?FreelanceDB.*?\]\(.*?\)/g, "");
    body = body.trimEnd();
    body += `\n\n---\n\nこの記事が参考になったら、ぜひLikeしていただけると励みになります。\nAI・開発ツールに関する記事を定期的に発信しています。フォローもお待ちしています。`;
    return { ...baseArticle, body, articleType: "roundup-zenn" };
  }
}

export async function generateRoundupQiitaVariation(
  baseArticle: GeneratedArticle,
): Promise<GeneratedArticle> {
  console.log("  Generating Qiita roundup variation...");

  const text = claudeCli(ROUNDUP_QIITA_REWRITE_SYSTEM_PROMPT + "\n\n" + `以下のAI/ツールまとめ記事をQiita向けに書き直してください。

## 元記事タイトル
${baseArticle.title}

## 元記事本文
${baseArticle.body}

## キーワード
${baseArticle.keywords.join(", ")}`);

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in Qiita roundup rewrite");
    const rewritten = JSON.parse(jsonMatch[0]) as {
      title: string;
      body: string;
      summary: string;
      keywords: string[];
    };

    console.log(`  Qiita roundup title: ${rewritten.title}`);
    console.log(`  Qiita roundup length: ${rewritten.body.length} chars`);

    const codeBlockCount = (rewritten.body.match(/```/g) || []).length / 2;
    console.log(`  Qiita roundup code blocks: ${Math.floor(codeBlockCount)}`);

    return {
      ...baseArticle,
      title: rewritten.title,
      body: rewritten.body,
      summary: rewritten.summary,
      keywords: rewritten.keywords || baseArticle.keywords,
      articleType: "roundup-qiita",
    };
  } catch {
    console.log("  Qiita roundup rewrite failed, using base article");
    return { ...baseArticle, articleType: "roundup-qiita" };
  }
}
