function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (!val) throw new Error(`Missing env: ${key}`);
  return val;
}

export const config = {
  xai: {
    apiKey: () => env("XAI_API_KEY"),
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4-1-fast-non-reasoning",
  },
  anthropic: {
    apiKey: () => env("ANTHROPIC_API_KEY"),
    model: "claude-sonnet-4-20250514",
  },
  qiita: {
    accessToken: () => env("QIITA_ACCESS_TOKEN"),
    baseUrl: "https://qiita.com/api/v2",
  },
  x: {
    consumerKey: () => env("X_CONSUMER_KEY"),
    consumerSecret: () => env("X_CONSUMER_SECRET"),
    accessToken: () => env("X_ACCESS_TOKEN"),
    accessSecret: () => env("X_ACCESS_SECRET"),
  },
  telegram: {
    botToken: () => env("TELEGRAM_BOT_TOKEN"),
    chatId: () => env("TELEGRAM_CHAT_ID"),
  },
  freelanceDbUrl: "https://freelance.radineer.asia/freelance/register",
  zenn: {
    articlesDir: "articles",
  },
} as const;

export type Config = typeof config;
