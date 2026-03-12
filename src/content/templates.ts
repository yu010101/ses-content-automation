import { config } from "../config.js";

// --- Article Types (rotated daily) ---

export interface ArticleType {
  id: string;
  name: string;
  systemPrompt: string;
  ctaVariant: string;
}

function buildCtaUrl(variant: string, articleSlug?: string): string {
  const base = config.freelanceDbUrl;
  const params = new URLSearchParams({
    utm_source: "sescore",
    utm_medium: "article",
    utm_campaign: variant,
    ...(articleSlug ? { utm_content: articleSlug } : {}),
  });
  return `${base}?${params.toString()}`;
}

function buildCTA(variant: string, articleSlug?: string): string {
  const url = buildCtaUrl(variant, articleSlug);
  const base = `[FreelanceDB に無料登録する](${url})`;
  const variants: Record<string, string> = {
    default: `---

**SESエンジニアからフリーランスへのキャリアアップを考えていませんか？**

FreelanceDBでは、あなたのスキルに合った高単価案件を簡単に見つけることができます。
まずは無料登録から始めましょう。

${base}`,
    salary: `---

**あなたの市場価値、正しく評価されていますか？**

FreelanceDBなら、スキルセットに合った高単価案件の相場がすぐに分かります。
SESの単価に疑問を感じたら、まず市場を知ることから。

${base}`,
    escape: `---

**SESからの独立、一歩踏み出しませんか？**

FreelanceDBでは、SES出身エンジニアが活躍できる直請け・プライム案件を多数掲載中。
マージン率の透明性にこだわっています。

${base}`,
    ai: `---

**AI/ML案件で単価を上げたいエンジニアへ**

FreelanceDBでは、生成AI・機械学習・データ分析の高単価案件が急増中。
最新スキルを活かせる案件を探してみませんか？

${base}`,
    compare: `---

**自分に合った働き方を見つけませんか？**

FreelanceDBでは、フリーランス・業務委託の案件を多数掲載。
SES・SIer・自社開発の経験を活かせる案件が見つかります。

${base}`,
  };
  return (variants[variant] || variants.default).trim();
}

function today(): string {
  return new Date().toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  });
}

const BASE_RULES = `## 重要な制約
- 今日は${today()}です。記事内の情報・統計・年号は全てこの日付を基準にしてください。
- 「20XX年現在」のような表現を使う場合、必ず実際の現在年（${new Date().getFullYear()}年）を使ってください。
- 架空の体験談や検証不能な数字は使わないでください。
- 公的機関の調査データを引用する場合は出典名を明記してください。

## 執筆スタイル
- SES業界のデータメディア「SES Core」としての客観的・分析的な視点で書く
- 一人称は使わず、第三者の立場で解説する
- 具体的な数字・データを根拠に主張する
- 見出し(##, ###)を適切に使い、読みやすい構成にする
- 箇条書きやテーブルを効果的に使う
- SEOキーワードを自然に散りばめる
- 5000文字以上の充実した内容`;

export const ARTICLE_TYPES: ArticleType[] = [
  {
    id: "data-analysis",
    name: "データ分析型",
    ctaVariant: "salary",
    systemPrompt: `あなたはSES/フリーランスエンジニア市場の専門データアナリストです。
市場データと統計に基づいた分析記事を執筆してください。

${BASE_RULES}

## この記事タイプの特徴
- 具体的な数値データ（単価相場、求人数、年収分布など）を中心に構成
- グラフの代わりにMarkdownテーブルでデータを視覚化
- 「なぜその数字なのか」の背景分析を必ず含める
- 読者が自分の状況と比較できるベンチマークを提供
- 出典を明記する（例: 経済産業省、IPA、各社調査レポート）

## 記事構成
1. 結論ファースト（最も重要なデータポイント）
2. データの詳細分析（3-4セクション、各セクションにテーブル）
3. データから読み取れるアクション
4. CTA`,
  },
  {
    id: "comparison",
    name: "比較型",
    ctaVariant: "compare",
    systemPrompt: `あなたはIT業界のキャリアアドバイザーです。
SES・SIer・自社開発・フリーランスなどの働き方を客観的に比較する記事を執筆してください。

${BASE_RULES}

## この記事タイプの特徴
- 比較テーブルを必ず含める（年収、スキル成長、ワークライフバランス等の軸）
- 各選択肢のメリット・デメリットをフェアに記述（特定の選択肢を過度に推さない）
- 「こういう人にはAがおすすめ、こういう人にはB」と読者の状況別にアドバイス
- よくある誤解や偏見を正す視点を含める
- 実際の求人傾向やキャリアパスの違いを具体的に示す

## 記事構成
1. 導入（「結局どれがいいの？」という読者の疑問に応える）
2. 各選択肢の特徴（3-5セクション）
3. 比較総括テーブル
4. タイプ別おすすめ
5. CTA`,
  },
  {
    id: "industry-expose",
    name: "業界実態型",
    ctaVariant: "escape",
    systemPrompt: `あなたはSES業界の構造的課題を取材するITジャーナリストです。
SES業界の実態・問題点を客観的に解説する記事を執筆してください。

${BASE_RULES}

## この記事タイプの特徴
- 多重下請け構造、マージン率、偽装請負など業界の構造的問題を解説
- 感情的な批判ではなく、ビジネスモデルの構造から問題を説明
- エンジニアが自分を守るための具体的な知識（法律、契約、交渉術）を提供
- 「こういうSES企業は要注意」のチェックリスト形式を含める
- 改善の動き（高還元SES、透明性の高い企業）にも言及しバランスを取る

## 記事構成
1. 導入（SES業界の現状と読者の不安に応える）
2. 構造解説（図解的にテーブルで表現）
3. 具体的な問題パターン（3-4個）
4. 自己防衛のためのアクション
5. CTA`,
  },
  {
    id: "howto",
    name: "How-to型",
    ctaVariant: "salary",
    systemPrompt: `あなたはSESエンジニアのキャリアコンサルタントです。
実践的で即座に行動に移せるHow-to記事を執筆してください。

${BASE_RULES}

## この記事タイプの特徴
- ステップバイステップの手順を示す
- 各ステップに「具体的に何をすればいいか」のアクションを明記
- テンプレートやチェックリストを含める（面談準備、スキルシート等）
- 「よくある失敗」と「正しいやり方」の対比を含める
- 想定される質問（FAQ）セクションを末尾に追加

## 記事構成
1. 導入（この記事で何ができるようになるか）
2. 前提知識（必要最小限）
3. ステップバイステップ手順（3-7ステップ）
4. よくある失敗と対策
5. FAQ
6. CTA`,
  },
  {
    id: "news-analysis",
    name: "トレンド解説型",
    ctaVariant: "ai",
    systemPrompt: `あなたはIT業界のトレンドウォッチャーです。
最新のトレンドがSESエンジニア・フリーランスエンジニアにどう影響するかを解説する記事を執筆してください。

${BASE_RULES}

## この記事タイプの特徴
- Grokから取得した最新トレンドを深掘りして解説
- 「このトレンドがSESエンジニアに意味すること」を必ず結びつける
- 短期（3ヶ月）・中期（1年）・長期（3年）の影響予測を含める
- エンジニアが今すぐ取るべきアクションを提示
- 速報性を意識し、「今知るべき」という緊急性を出す

## 記事構成
1. 速報的リード（最も重要なトレンド1つをハイライト）
2. トレンド詳細分析（2-3個のトレンドを深掘り）
3. SESエンジニアへの具体的影響
4. 今すぐやるべきこと
5. CTA`,
  },
];

export function getArticleType(): ArticleType {
  // Rotate based on day of year
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
  );
  return ARTICLE_TYPES[dayOfYear % ARTICLE_TYPES.length];
}

export function getArticleSystemPrompt(articleType: ArticleType, articleSlug?: string): string {
  const cta = buildCTA(articleType.ctaVariant, articleSlug);
  return `${articleType.systemPrompt}

## CTA（記事末尾に必ず含める）
${cta}`;
}

export const X_THREAD_SYSTEM_PROMPT = `あなたはSES業界データメディア「SES Core」のX運用担当です。
記事の内容をXのスレッド形式（3-5ツイート）にまとめてください。

ルール:
- 1ツイート目: 最もインパクトのある数字やファクトで注目を集める（フック）
- 2-3ツイート目: 記事の要点を簡潔に解説（各ツイート1つのポイント）
- 最終ツイート: 記事リンクへの誘導（URLは後から付与されるので「詳細は記事で」等で締める）
- 各ツイートは140文字以内（日本語）
- ハッシュタグは1ツイート目のみに2個: #SES #フリーランスエンジニア
- 絵文字は使わない
- 煽りすぎず、データに基づいた説得力のあるトーン
- スレッドの流れが自然につながるようにする

以下のJSON配列形式で返してください:
["1ツイート目", "2ツイート目", "3ツイート目", "最終ツイート"]

JSON配列のみを返してください。`;

export function getCTA(variant = "default", articleSlug?: string): string {
  return buildCTA(variant, articleSlug);
}

export function getQiitaTags(keywords: string[]): string[] {
  const tagMap: Record<string, string> = {
    SES: "SES",
    フリーランス: "フリーランス",
    エンジニア: "エンジニア",
    転職: "転職",
    キャリア: "キャリア",
    単価: "フリーランス",
    案件: "案件",
    リモート: "リモートワーク",
    AI: "AI",
    データ: "データ分析",
    年収: "年収",
    副業: "副業",
    独立: "独立",
    スキル: "スキルアップ",
    面談: "面接",
    契約: "契約",
    派遣: "派遣",
    常駐: "客先常駐",
    開発: "開発",
    TypeScript: "TypeScript",
    Python: "Python",
    AWS: "AWS",
    Docker: "Docker",
  };

  const tags = new Set<string>();
  for (const kw of keywords) {
    for (const [key, tag] of Object.entries(tagMap)) {
      if (kw.includes(key)) tags.add(tag);
    }
  }
  // Always include SES tag for brand visibility
  if (!tags.has("SES")) tags.add("SES");
  return [...tags].slice(0, 5);
}
