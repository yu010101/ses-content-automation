import { execSync } from "node:child_process";

export function claudeCli(prompt: string, maxTokens?: number): string {
  try {
    const args = maxTokens ? `--max-tokens ${maxTokens}` : '';
    const result = execSync(
      `claude -p ${JSON.stringify(prompt)} ${args}`,
      {
        timeout: 300000,
        encoding: "utf-8",
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: '',
          PATH: `${process.env.HOME}/.local/bin:${process.env.HOME}/.nvm/versions/node/v22.21.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`
        }
      }
    ).trim();
    return result;
  } catch (e) {
    console.error("Claude CLI error:", e instanceof Error ? e.message : e);
    return "";
  }
}
