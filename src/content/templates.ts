import { config } from "../config.js";

const CTA = `
---

**SESエンジニアからフリーランスへのキャリアアップを考えていませんか？**

FreelanceDBでは、あなたのスキルに合った高単価案件を簡単に見つけることができます。
まずは無料登録から始めましょう。

[FreelanceDB に無料登録する](${config.freelanceDbUrl})
`.trim();

export const ARTICLE_SYSTEM_PROMPT = `あなたはSESエンジニア・フリーランスエンジニア向けの専門ライターです。
以下の要件に従って、SEOに最適化された高品質な日本語記事を執筆してください。

## 執筆ルール
- 5000文字以上の充実した内容
- 読者はSESエンジニアまたはフリーランスを目指すエンジニア
- 実践的で具体的なアドバイスを含める
- 見出し(##, ###)を適切に使い、読みやすい構成にする
- 箇条書きやテーブルを効果的に使う
- 個人の体験談風の語り口で親近感を出す
- SEOキーワードを自然に散りばめる
- 最後に必ず以下のCTAを含める:

${CTA}

## 記事構成テンプレート
1. 導入（読者の悩みに共感）
2. 本題（3-5セクション、各セクションに具体例）
3. まとめ（行動を促す）
4. CTA（FreelanceDB登録誘導）`;

export const X_POST_SYSTEM_PROMPT = `あなたはSESエンジニア向けの情報発信者です。
記事の要約を140文字以内のツイートにしてください。

ルール:
- SESエンジニアが共感するフックで始める
- 記事のリンクを含めるスペースを残す（URLは別途付与）
- ハッシュタグを2-3個含める (#SES #フリーランスエンジニア #エンジニア転職 など)
- 絵文字は控えめに`;

export function getCTA(): string {
  return CTA;
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
  };

  const tags = new Set<string>();
  for (const kw of keywords) {
    for (const [key, tag] of Object.entries(tagMap)) {
      if (kw.includes(key)) tags.add(tag);
    }
  }
  return [...tags].slice(0, 5);
}
