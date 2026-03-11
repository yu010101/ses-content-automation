import OpenAI from "openai";
import { config } from "../config.js";

export interface MarketData {
  averageSalary: string;
  topSkills: string[];
  jobCount: string;
  yearOverYear: string;
  sources: string[];
  rawFacts: string[];
}

/**
 * Use Grok to search for real-time SES/freelance market data from the web.
 * Grok has access to X posts and web data, making it ideal for fresh statistics.
 */
export async function fetchMarketData(): Promise<MarketData> {
  const client = new OpenAI({
    apiKey: config.xai.apiKey(),
    baseURL: config.xai.baseUrl,
  });

  const response = await client.chat.completions.create({
    model: config.xai.model,
    messages: [
      {
        role: "system",
        content: `あなたはSES/フリーランスエンジニア市場のリサーチャーです。
最新のWeb情報やX上の投稿から、信頼できる市場データを収集してください。
必ず情報源を明記してください。推測や架空のデータは絶対に含めないでください。
見つからないデータは「データなし」と回答してください。`,
      },
      {
        role: "user",
        content: `以下のSES/フリーランスエンジニア市場データを最新の情報から調査してください:

1. SESエンジニアの平均月額単価（経験年数別）
2. フリーランスエンジニアの需要が高いスキルTOP5
3. IT人材の求人倍率または求人数の最新データ
4. 前年比でのSES/フリーランス市場の変化

以下のJSON形式で返してください:
{
  "averageSalary": "SESエンジニアの平均単価に関する具体的な数値と出典",
  "topSkills": ["需要スキル1", "需要スキル2", "需要スキル3", "需要スキル4", "需要スキル5"],
  "jobCount": "求人数または求人倍率の具体的データと出典",
  "yearOverYear": "前年比の変化に関する具体的データ",
  "sources": ["出典1", "出典2", "出典3"],
  "rawFacts": [
    "記事に使える具体的なファクト1",
    "記事に使える具体的なファクト2",
    "記事に使える具体的なファクト3",
    "記事に使える具体的なファクト4",
    "記事に使える具体的なファクト5"
  ]
}

JSONのみを返してください。`,
      },
    ],
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from Grok market data query");
  }

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.warn("Failed to parse market data, using fallback");
    return {
      averageSalary: "データ取得失敗",
      topSkills: ["React", "AWS", "Python", "TypeScript", "Docker"],
      jobCount: "データ取得失敗",
      yearOverYear: "データ取得失敗",
      sources: [],
      rawFacts: [],
    };
  }
}

/**
 * Format market data as context string for article generation.
 */
export function formatMarketContext(data: MarketData): string {
  const facts = data.rawFacts.length > 0
    ? data.rawFacts.map((f) => `- ${f}`).join("\n")
    : "（ファクトデータなし）";

  const sources = data.sources.length > 0
    ? data.sources.map((s) => `- ${s}`).join("\n")
    : "（出典なし）";

  return `## 最新市場データ（記事に必ず引用すること）
### 単価相場
${data.averageSalary}

### 需要スキルTOP5
${data.topSkills.map((s, i) => `${i + 1}. ${s}`).join("\n")}

### 求人市場
${data.jobCount}

### 前年比トレンド
${data.yearOverYear}

### 記事に使えるファクト
${facts}

### 出典（記事内で必ず明記すること）
${sources}`;
}
