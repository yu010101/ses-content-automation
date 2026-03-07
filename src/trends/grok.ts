import OpenAI from "openai";
import { config } from "../config.js";

export interface TrendResult {
  topic: string;
  summary: string;
  tweetExamples: string[];
  relevanceScore: number;
}

export async function discoverTrends(): Promise<TrendResult[]> {
  const client = new OpenAI({
    apiKey: config.xai.apiKey(),
    baseURL: config.xai.baseUrl,
  });

  const seeds = [
    "SES エンジニア 最新動向",
    "フリーランスエンジニア トレンド",
    "IT人材 市場",
    "エンジニア 単価 相場",
  ];

  const results: TrendResult[] = [];

  for (const seed of seeds) {
    const response = await client.chat.completions.create({
      model: config.xai.model,
      messages: [
        {
          role: "system",
          content:
            "あなたはSESエンジニア・フリーランスエンジニア市場のトレンドアナリストです。X上の最新投稿を検索し、SES/フリーランスエンジニアに関連するトレンドトピックを特定してください。",
        },
        {
          role: "user",
          content: `以下のキーワードでX上のトレンドを検索し、SESエンジニアやフリーランスエンジニアに関連する注目トピックを3つ見つけてください。

検索キーワード: ${seed}

各トピックについて以下のJSON形式で返してください:
[
  {
    "topic": "トピック名",
    "summary": "100文字程度の要約",
    "tweetExamples": ["参考になるツイート例1", "参考になるツイート例2"],
    "relevanceScore": 0.0-1.0
  }
]

JSONのみを返してください。`,
        },
      ],
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) continue;

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed: TrendResult[] = JSON.parse(jsonMatch[0]);
        results.push(...parsed);
      }
    } catch {
      console.warn(`Failed to parse trends for seed: ${seed}`);
    }
  }

  // Deduplicate and sort by relevance
  const seen = new Set<string>();
  return results
    .filter((t) => {
      if (seen.has(t.topic)) return false;
      seen.add(t.topic);
      return true;
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);
}
