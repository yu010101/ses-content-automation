# SES Content Automation

SES業界特化コンテンツ自動生成・配信システム

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────┐
│  Grok API   │────▶│  Claude API  │────▶│   Publishers    │────▶│ Analytics  │
│ (xAI)       │     │ (Anthropic)  │     │                 │     │            │
│             │     │              │     │ - Qiita         │     │ パフォーマンス│
│ トレンド検索  │     │ 記事生成      │     │ - Zenn          │     │ 分析        │
│ 市場データ取得│     │ プラットフォーム│     │ - note.com      │     │ 学習ループ  │
│             │     │ 最適化        │     │ - X (Twitter)   │     │            │
└─────────────┘     └──────────────┘     └─────────────────┘     └────────────┘
```

**Pipeline Flow (5 steps):**

1. Grok APIでSES業界トレンド検索 + 市場データ取得
2. Claude APIで記事生成 (Note/Zenn/Qiita各プラットフォーム最適化バリエーション含む)
3. Telegram承認フロー (optional)
4. 4プラットフォーム同時配信
5. 結果記録 + X投稿バリエーション生成

## Setup

### Prerequisites

- Node.js >= 18
- npm

### Install

```bash
npm install
npx playwright install chromium
```

### Environment Variables

`.env.example` をコピーして `.env` を作成し、各値を設定する。

```bash
cp .env.example .env
```

| 変数名 | 説明 |
|--------|------|
| `XAI_API_KEY` | Grok API (xAI) キー。トレンド検索・市場データ取得に使用 |
| `ANTHROPIC_API_KEY` | Claude API (Anthropic) キー。記事生成に使用 |
| `QIITA_ACCESS_TOKEN` | Qiita APIトークン。記事投稿に使用 |
| `QIITA_ORG_NAME` | Qiita Organization名 (optional) |
| `X_CONSUMER_KEY` | X (Twitter) API Consumer Key |
| `X_CONSUMER_SECRET` | X (Twitter) API Consumer Secret |
| `X_ACCESS_TOKEN` | X (Twitter) API Access Token |
| `X_ACCESS_SECRET` | X (Twitter) API Access Secret |
| `TELEGRAM_BOT_TOKEN` | Telegram Botトークン。承認フロー・日次レポートに使用 |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID。通知先 |
| `GITHUB_TOKEN` | GitHub PAT。Zenn記事のGitHub連携に使用 |

## Commands

```bash
# フルパイプライン実行
npm run pipeline
npm run pipeline:dry          # dry-run (実際には投稿しない)

# 個別コマンド (tsx src/index.ts <command>)
tsx src/index.ts trends                          # トレンド検索
tsx src/index.ts analytics                       # パフォーマンスデータ収集・表示
tsx src/index.ts feedback                        # パフォーマンス分析・学習状態更新
tsx src/index.ts report                          # Telegram日次レポート送信
tsx src/index.ts meta-article                    # メタ分析記事生成
tsx src/index.ts x-generate <article-url>        # X投稿バリエーション生成
tsx src/index.ts x-post <morning|noon|evening>   # キュー内X投稿を実行
tsx src/index.ts x-quote [--dry-run]             # インフルエンサー引用リポスト

# 単一プラットフォーム投稿
npm run publish:qiita
npm run publish:zenn
npm run publish:note
npm run publish:x
```

### Flags

| Flag | 説明 |
|------|------|
| `--dry-run` | 実際の投稿をスキップ。動作確認用 |
| `--skip-approval` | Telegram承認ステップをスキップ |

## Crontab Example

```cron
# 毎日9:00にフルパイプライン実行 (承認スキップ)
0 9 * * * cd /Users/yu01/ses-content-automation && npx tsx src/index.ts pipeline --skip-approval >> logs/pipeline.log 2>&1

# X投稿: 朝8:00 / 昼12:00 / 夕方18:00
0 8 * * * cd /Users/yu01/ses-content-automation && npx tsx src/index.ts x-post morning >> logs/x-post.log 2>&1
0 12 * * * cd /Users/yu01/ses-content-automation && npx tsx src/index.ts x-post noon >> logs/x-post.log 2>&1
0 18 * * * cd /Users/yu01/ses-content-automation && npx tsx src/index.ts x-post evening >> logs/x-post.log 2>&1

# 引用リポスト: 毎日15:00
0 15 * * * cd /Users/yu01/ses-content-automation && npx tsx src/index.ts x-quote >> logs/x-quote.log 2>&1

# 日次レポート: 毎日21:00
0 21 * * * cd /Users/yu01/ses-content-automation && npx tsx src/index.ts report >> logs/report.log 2>&1

# パフォーマンス分析: 毎週月曜10:00
0 10 * * 1 cd /Users/yu01/ses-content-automation && npx tsx src/index.ts feedback >> logs/feedback.log 2>&1
```

## Data Files

`data/` ディレクトリに以下のJSONファイルを配置する。

| ファイル | 説明 |
|---------|------|
| `keywords.json` | SEOキーワード定義。`primary`, `secondary`, `high_conversion`, `tech_keywords`, `ai_keywords`, `angle_seeds` |
| `published.json` | 投稿済み記事の記録。タイトル重複チェック・内部リンク生成に使用 |
| `x-queue.json` | X投稿キュー。時間帯別バリエーション管理 |
| `learning-state.json` | パフォーマンス学習状態。最適キーワード・タイトルパターン等 |

## Project Structure

```
ses-content-automation/
├── src/
│   ├── index.ts              # CLI entrypoint
│   ├── config.ts             # 環境変数・API設定
│   ├── pipeline.ts           # メインパイプライン
│   ├── trends/               # Grok APIトレンド検索・市場データ
│   ├── content/              # Claude API記事生成・内部リンク・メタ記事
│   ├── publishers/           # Qiita, Zenn, X, note.com パブリッシャー
│   ├── analytics/            # パフォーマンス収集・分析・レポート
│   ├── approval/             # Telegram承認フロー
│   └── x-amplification/      # X投稿バリエーション・引用リポスト
├── data/                     # 実行時データ (JSON)
├── .env                      # 環境変数 (git管理外)
├── package.json
└── tsconfig.json
```
