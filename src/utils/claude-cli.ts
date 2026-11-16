import { spawnSync } from "node:child_process";

const CLAUDE_BIN = "/Users/apple/.local/bin/claude";
const DEFAULT_TIMEOUT_MS = 900_000; // 15min
const MAX_ATTEMPTS = 3;

export function claudeCli(prompt: string, maxTokens?: number): string {
  const args = ["-p", prompt];
  if (maxTokens) {
    args.push("--max-tokens", String(maxTokens));
  }

  const baseEnv = {
    ...process.env,
    PATH: `${process.env.HOME}/.local/bin:${process.env.HOME}/.nvm/versions/node/v22.22.2/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
  };
  // CLI のログイン(定額)だけで動かす。API キーには切り替えない。
  // 2026-09-06 に OAuth 切れの退避として API キーでの再試行を入れたが、
  // 2026-11-16 (RB-5020) に廃止。鍵の従量課金に黙って流れるのを防ぐため、
  // .env から ANTHROPIC_API_KEY が渡ってきても子プロセスには渡さない。
  // ログインが全滅したら空文字を返して止まる(呼び出し側は空を失敗として扱う)。
  const env: Record<string, string | undefined> = { ...baseEnv };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = spawnSync(CLAUDE_BIN, args, {
        timeout: DEFAULT_TIMEOUT_MS,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        env,
      });

      if (r.error) throw r.error;
      if (r.status !== 0) {
        throw new Error(
          `claude exited with status=${r.status} signal=${r.signal} stderr=${(r.stderr ?? "").slice(0, 500)}`,
        );
      }

      const out = (r.stdout ?? "").trim();
      if (!out) {
        throw new Error("claude returned empty stdout");
      }
      return out;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[claudeCli] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg}`);
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        const wait = new Int32Array(new SharedArrayBuffer(4));
        Atomics.wait(wait, 0, 0, backoffMs);
      }
    }
  }

  console.error("[claudeCli] all attempts exhausted:", lastErr);
  console.error(
    "[claudeCli] CLI のログインが使えないため停止します(API キーには切り替えません)。M4 で claude setup-token を確認してください",
  );
  return "";
}
