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
  // Pro plan login を優先する(定額なので従量課金より安い)。
  // 2026-09-06: OAuth が期限切れでリフレッシュ不能になり
  //   Failed to authenticate: OAuth session expired and could not be refreshed
  // で全生成が停止した。.env に有効な ANTHROPIC_API_KEY があるのにここで
  // 消していたため退避先が無かった。
  // → Pro を先に試し、全部失敗した時だけ API キーで1回再試行する。
  //   呼び出しは CLI のまま(API直叩きはしない)。課金が出るので必ずログに残す。
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const env: Record<string, string | undefined> = { ...baseEnv };
  delete env.ANTHROPIC_API_KEY;

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

  // Pro が全滅した場合のみ、CLI に API キーを渡して1回だけ拾いにいく。
  if (apiKey) {
    console.error("[claudeCli] Pro login が全滅。ANTHROPIC_API_KEY で再試行します(従量課金)");
    const r = spawnSync(CLAUDE_BIN, args, {
      timeout: DEFAULT_TIMEOUT_MS,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
      env: { ...baseEnv, ANTHROPIC_API_KEY: apiKey },
    });
    const out = (r.stdout ?? "").trim();
    if (r.status === 0 && out) {
      console.error("[claudeCli] API キーでの再試行に成功");
      return out;
    }
    console.error(
      `[claudeCli] API キーでの再試行も失敗: status=${r.status} stderr=${(r.stderr ?? "").slice(0, 300)}`,
    );
  }

  return "";
}
