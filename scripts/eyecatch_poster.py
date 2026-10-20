# 2026-10-20 本人指摘「アイキャッチ変」: 棒人間＋「SES解体新書」の型をやめ、題を大きく置く型にする（note の上位記事の実測と 10/20 の2本に合わせた）
# 使い方: python eyecatch_poster.py spec.json out.png   spec = {"lead": "...", "main": "...", "tail": "..."}
import json, sys, html
from playwright.sync_api import sync_playwright
spec = json.load(open(sys.argv[1], encoding="utf-8")); out = sys.argv[2]
e = lambda k: html.escape(spec.get(k) or "")
main = spec.get("main") or ""
size = 76 if len(main) <= 8 else 64 if len(main) <= 11 else 54 if len(main) <= 14 else 46 if len(main) <= 18 else 40 if len(main) <= 24 else 34
page = f"""<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0}}
body{{width:1280px;height:670px;background:#FBF7EF;font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;color:#1F2A44;position:relative;overflow:hidden}}
.wrap{{position:absolute;left:80px;right:440px;top:150px}}
.lead{{font-size:34px;color:#5B6475;font-weight:500;margin-bottom:26px}}
.mainwrap{{text-wrap:balance;line-height:1.35}}
.main{{display:inline;font-size:{size}px;font-weight:800;line-height:1.35;background:linear-gradient(transparent 12%,#F5C542 12%,#F5C542 92%,transparent 92%);box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:0 10px}}
.tail{{font-size:38px;font-weight:700;margin-top:34px;line-height:1.45}}
.foot{{position:absolute;left:80px;bottom:46px;font-size:24px;color:#5B6475}}
.bar{{position:absolute;right:80px;bottom:56px;width:120px;height:8px;background:linear-gradient(90deg,#F5C542 0 40%,#3E7CB1 40% 70%,#1F2A44 70%)}}
</style></head><body><div class="wrap"><div class="lead">{e('lead')}</div><div class="mainwrap"><span class="main">{e('main')}</span></div><div class="tail">{e('tail')}</div></div>
<svg style="position:absolute;right:70px;top:150px;opacity:.9" width="330" height="310" viewBox="0 0 330 310"><rect x="0" y="210" width="32" height="90" rx="4" fill="#E4E0D6"/><rect x="46" y="160" width="32" height="140" rx="4" fill="#E4E0D6"/><rect x="92" y="110" width="32" height="190" rx="4" fill="#D9D3C4"/><rect x="138" y="50" width="32" height="250" rx="4" fill="#F5C542"/><rect x="184" y="90" width="32" height="210" rx="4" fill="#D9D3C4"/><rect x="230" y="140" width="32" height="160" rx="4" fill="#E4E0D6"/><rect x="276" y="180" width="32" height="120" rx="4" fill="#E4E0D6"/><line x1="0" y1="301" x2="320" y2="301" stroke="#C9C2B2" stroke-width="2"/></svg><div class="foot">FreelanceDB｜フリーランスエンジニアの案件データベース</div><div class="bar"></div></body></html>"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 670}, device_scale_factor=2)
    pg.set_content(page); pg.wait_for_timeout(300); pg.screenshot(path=out); b.close()
print(out)
