#!/bin/bash
# Usage: bash generate-diagram.sh "AIエージェントの構成図" /tmp/diagram.png
# Generates a diagram image using Claude CLI + Playwright screenshot
set -euo pipefail

NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

TOPIC="${1:?Usage: generate-diagram.sh <topic> [output_path]}"
OUTPUT="${2:-/tmp/diagram.png}"
HTML_TMP="/tmp/diagram-$(date +%s).html"

echo "[1/3] Generating SVG diagram for: $TOPIC"

SVG=$(claude --print "以下のテーマの図解をSVGで生成してください。

テーマ: $TOPIC

## 要件
- 1200x675px のSVG（X投稿用OGP比率）
- 背景: ダークグラデーション（#0a0a0a → #1a1a2e）
- フォント: sans-serif、日本語対応
- 色: ブルー系アクセント（#3b82f6, #8b5cf6）
- ボックス、矢印、ラベルで構成要素を明示
- テーマに応じたフローチャート/アーキテクチャ図/概念図を描く
- 図の下部右に小さく @web3master555 のクレジット

SVGコードのみを返してください。説明は不要です。")

# Wrap SVG in HTML for Playwright rendering
cat > "$HTML_TMP" << HTMLEOF
<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; }
  body { width: 1200px; height: 675px; overflow: hidden; background: #0a0a0a; }
  svg { width: 1200px; height: 675px; }
</style></head>
<body>
${SVG}
</body></html>
HTMLEOF

echo "[2/3] Capturing screenshot -> $OUTPUT"

npx --yes tsx -e "
import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
  await page.goto('file://${HTML_TMP}');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '${OUTPUT}', type: 'png' });
  await browser.close();
  console.log('Screenshot saved: ${OUTPUT}');
})();
" 2>&1

rm -f "$HTML_TMP"

echo "[3/3] Done: $OUTPUT"
echo "$OUTPUT"
