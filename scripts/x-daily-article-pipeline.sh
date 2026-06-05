#!/bin/bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# X記事 自動パイプライン — 毎日1記事を自動生成・投稿
#
# 流れ:
#   1. SocialData APIでバズ記事リサーチ（latest.jsonから選択）
#   2. 記事URLの中身をfetch
#   3. Claude CLIでX Article生成（x-article-generatorスキルの文体ルール準拠）
#   4. /tmp/x-longpost.txtに書き出し
#   5. post-to-x.tsで投稿
#
# 毎日17:00にcronで実行
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESEARCH_FILE="$PROJECT_DIR/data/x-research/latest.json"
POSTED_LOG="$PROJECT_DIR/data/x-research/posted.json"
LONGPOST="/tmp/x-longpost.txt"
CLAUDE="$HOME/.local/bin/claude"
LOG_DIR="$HOME/kpi-dashboard/data/logs"

# .env読み込み（X API credentials）
export $(grep -E '^X_' "$PROJECT_DIR/.env" | xargs) 2>/dev/null

# 投稿済みログ初期化
[ ! -f "$POSTED_LOG" ] && echo '[]' > "$POSTED_LOG"

echo "[x-pipeline] $(date '+%Y-%m-%d %H:%M') パイプライン開始"

# ━━━ Step 1: リサーチデータが古い場合は再取得 ━━━
RESEARCH_AGE=999
if [ -f "$RESEARCH_FILE" ]; then
  RESEARCH_AGE=$(python3 -c "
import json, os
from datetime import datetime
with open('$RESEARCH_FILE') as f:
    d = json.load(f)
ts = d.get('researched_at', '')
if ts:
    dt = datetime.fromisoformat(ts)
    print(int((datetime.now() - dt).total_seconds() / 3600))
else:
    print(999)
" 2>/dev/null)
fi

if [ "$RESEARCH_AGE" -gt 72 ]; then
  echo "[x-pipeline] リサーチデータが${RESEARCH_AGE}h前。再取得..."
  bash "$SCRIPT_DIR/x-article-research.sh" 300 'Claude OR AI OR エージェント OR LLM OR 自動化'
  sleep 2
fi

# ━━━ Step 2: 未投稿のバズ記事URLを選択 ━━━
ARTICLE_URL=$(python3 -c "
import json

with open('$RESEARCH_FILE') as f:
    research = json.load(f)
with open('$POSTED_LOG') as f:
    posted = json.load(f)

posted_urls = set(p.get('url','') for p in posted)
candidates = [a for a in research.get('jp_articles', []) if a['url'] not in posted_urls and a.get('likes', 0) >= 200]

if not candidates:
    print('NONE')
else:
    # エンゲージメント重み付きランダム選択（上位ほど選ばれやすい）
    import random
    weights = [c.get('likes', 1) for c in candidates[:15]]
    chosen = random.choices(candidates[:15], weights=weights, k=1)[0]
    print(chosen['url'])
" 2>/dev/null)

if [ "$ARTICLE_URL" = "NONE" ] || [ -z "$ARTICLE_URL" ]; then
  echo "[x-pipeline] 未投稿の記事なし。リサーチを再実行..."
  bash "$SCRIPT_DIR/x-article-research.sh" 200 'Claude OR AI OR エージェント OR プログラミング OR 副業'
  sleep 2

  ARTICLE_URL=$(python3 -c "
import json
with open('$RESEARCH_FILE') as f:
    research = json.load(f)
with open('$POSTED_LOG') as f:
    posted = json.load(f)
posted_urls = set(p.get('url','') for p in posted)
candidates = [a for a in research.get('jp_articles', []) if a['url'] not in posted_urls and a.get('likes', 0) >= 100]
if candidates:
    print(candidates[0]['url'])
else:
    print('NONE')
" 2>/dev/null)

  if [ "$ARTICLE_URL" = "NONE" ] || [ -z "$ARTICLE_URL" ]; then
    echo "[x-pipeline] ❌ 投稿可能な記事が見つからない。終了。"
    exit 0
  fi
fi

echo "[x-pipeline] 選択記事: $ARTICLE_URL"

# ━━━ Step 3: 記事内容を取得してX Article生成 ━━━
echo "[x-pipeline] X Article生成中..."

PROMPT_FILE="/tmp/x-article-prompt.txt"
cat > "$PROMPT_FILE" << PROMPT_EOF
WebFetchで以下URLの記事を読み、Xのlong tweet（長文ポスト）として最適化された紹介テキストを生成せよ。

URL: $ARTICLE_URL

【最重要: Xポスト最適化ルール】
Xはプレーンテキスト。Markdownは一切レンダリングされない。以下を厳守:
- #, ##, >, - などのMarkdown記法は絶対に使うな
- セクション区切りは「▼ セクション名」を使う
- 箇条書きは「・」を使う
- 引用は「」で囲む
- @メンションは必ず文中にインラインで書く（前後に改行を入れない）
- 「記事全文を取得できました」等の作業報告は絶対に出力しない

【文体ルール】
- 断言する。「〜かもしれません」「〜と言えるでしょう」禁止
- 短い文と長い文を交互に。リズムを作る
- 読者に語りかける
- 感情の動きを書く。「正直、驚いた」「これは面白い」
- 段落で書く。リスト形式は補足的に使う程度

【構成テンプレート】
タイトル行（キャッチーな一文）

冒頭フック（2-3行で引き込む。@著者名 さんの記事が面白かったので紹介、的な導入）

▼ セクション1
本文（記事の要点を自分の言葉で解説）

▼ セクション2
本文（著者の言葉を「」で引用しつつ解説）

▼ セクション3
本文

▼ まとめ
読者への行動喚起 or 教訓

詳しくは@著者名 さんの元記事にて
元記事URL

【文量】1,500〜2,500文字
【出力】投稿テキストのみ。前置き・後書き・作業報告は一切不要。
PROMPT_EOF

ARTICLE_TEXT=$(ANTHROPIC_API_KEY="" timeout 300 $CLAUDE -p --allowedTools "WebFetch" < "$PROMPT_FILE" 2>/dev/null)

# 後処理: Markdown記法の残留を除去し、プレーンテキストに整形
ARTICLE_TEXT=$(echo "$ARTICLE_TEXT" | python3 -c "
import sys, re
text = sys.stdin.read().strip()
# Claude CLIの前置きを除去（最初の実質的な行まで飛ばす）
lines = text.split('\n')
start = 0
for i, line in enumerate(lines):
    s = line.strip()
    # 空行、作業報告っぽい行をスキップ
    if not s or s.startswith('記事') or s.startswith('以下') or s.startswith('---'):
        start = i + 1
    else:
        break
text = '\n'.join(lines[start:])
# Markdown記法を除去
text = re.sub(r'^#{1,3}\s+', '', text, flags=re.MULTILINE)  # # 見出し
text = re.sub(r'^>\s*', '「', text, flags=re.MULTILINE)      # > 引用 → 「
text = re.sub(r'^-\s+', '・', text, flags=re.MULTILINE)      # - リスト → ・
text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)                 # **太字** → 太字
text = re.sub(r'\*(.+?)\*', r'\1', text)                     # *斜体* → 斜体
text = re.sub(r'---+', '', text)                              # --- 区切り線
# @メンション周りの不要改行を修正
text = re.sub(r'\n(@\w+)\s*\n', r' \1 ', text)
# 連続空行を2行まで
text = re.sub(r'\n{3,}', '\n\n', text)
print(text.strip())
")

if [ -z "$ARTICLE_TEXT" ]; then
  echo "[x-pipeline] ❌ 記事生成失敗"
  exit 1
fi

# ━━━ Step 4: /tmp/x-longpost.txtに書き出し ━━━
echo "$ARTICLE_TEXT" > "$LONGPOST"
CHAR_COUNT=$(wc -m < "$LONGPOST" | tr -d ' ')
echo "[x-pipeline] 記事生成完了（${CHAR_COUNT}文字）"

# 文字数チェック（最低500文字）
if [ "$CHAR_COUNT" -lt 500 ]; then
  echo "[x-pipeline] ❌ 文字数不足（${CHAR_COUNT}文字 < 500文字）。スキップ。"
  exit 1
fi

# ━━━ Step 5: X APIで投稿 ━━━
echo "[x-pipeline] X投稿中..."
cd "$PROJECT_DIR"
POST_RESULT=$(npx tsx scripts/post-to-x.ts 2>&1)
echo "[x-pipeline] $POST_RESULT"

# 投稿成功チェック
if echo "$POST_RESULT" | grep -q "✅ Posted"; then
  POST_URL=$(echo "$POST_RESULT" | grep "✅ Posted" | sed 's/.*Posted: //')
  echo "[x-pipeline] ✅ 投稿成功: $POST_URL"

  # 投稿済みログに記録
  python3 -c "
import json
from datetime import datetime
with open('$POSTED_LOG') as f:
    posted = json.load(f)
posted.append({
    'url': '$ARTICLE_URL',
    'posted_at': datetime.now().isoformat(),
    'post_url': '$POST_URL',
    'chars': $CHAR_COUNT,
})
# 最新100件のみ保持
posted = posted[-100:]
with open('$POSTED_LOG', 'w') as f:
    json.dump(posted, f, ensure_ascii=False, indent=2)
"
else
  echo "[x-pipeline] ❌ 投稿失敗"
  exit 1
fi

echo "[x-pipeline] $(date '+%Y-%m-%d %H:%M') パイプライン完了"
