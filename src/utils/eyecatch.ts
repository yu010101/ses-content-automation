import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ~/.claude/skills/kv の render_kv.py で描く(宣言的 spec → HTML → PNG。日本語フォント込みで文字化けしない)。
// kv は playwright 入りの python が要る。M4 では openclaw-sns の venv がそれを持っている(2026-10-08 確認)。
const HOME = process.env.HOME ?? "";
const KV_DIR = join(HOME, ".claude/skills/kv");
const KV_PY = process.env.KV_PYTHON ?? join(HOME, "openclaw-sns/.venv/bin/python");

export interface EyecatchCopy { lead?: string; main: string; tail?: string }

/** 題名から3行を作る(LLMが eyecatch を返さなかった時の代わり) */
export function copyFromTitle(title: string): EyecatchCopy {
  // 句で区切り、2句以上なら「前置き=最初の句 / 主題=次の句 / 補足=残り」。1句なら主題だけ
  const parts = title.split(/[。、｜|―—:：]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { lead: parts[0].slice(0, 30), main: parts[1].slice(0, 30), tail: parts.slice(2).join(" ").slice(0, 36) }; // 2026-10-20: 主題を18字で切ると「…会社が回」のように途中で切れた
  }
  return { lead: "", main: (parts[0] ?? title).slice(0, 30), tail: "" };
}

const q = (s: string) => JSON.stringify(s ?? "");

/** PNG を書いてパスを返す。失敗したら null(投稿は止めない) */
export function renderEyecatch(copy: EyecatchCopy, outDir: string, slug: string): string | null {
  // 2026-10-20 本人指摘「アイキャッチ変」: 棒人間＋「SES解体新書」の kv テンプレートをやめ、題を大きく置く型（scripts/eyecatch_poster.py）にした。
  // 元の kv 版は eyecatch.ts.bak-20261020-poster
  const script = join(process.cwd(), "scripts", "eyecatch_poster.py");
  if (!existsSync(script) || !existsSync(KV_PY)) {
    console.error(`[eyecatch] 描画の部品が無い: ${script} / ${KV_PY}`);
    return null;
  }
  mkdirSync(outDir, { recursive: true });
  const spec = join(outDir, `${slug}.json`);
  const png = join(outDir, `${slug}.png`);
  writeFileSync(spec, JSON.stringify({ lead: copy.lead ?? "", main: copy.main, tail: copy.tail ?? "" }), "utf-8");
  const r = spawnSync(KV_PY, [script, spec, png], { encoding: "utf-8", timeout: 120_000 });
  if (r.status !== 0 || !existsSync(png)) {
    console.error(`[eyecatch] 描画に失敗: ${(r.stderr ?? "").slice(-300)}`);
    return null;
  }
  return png;
}
