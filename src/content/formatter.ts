import { config } from "../config.js";
import { getQiitaTags } from "./templates.js";
import type { GeneratedArticle } from "./generator.js";

export interface QiitaPayload {
  title: string;
  body: string;
  tags: { name: string }[];
  private: boolean;
  organization_url_name?: string;
}

export interface ZennFrontmatter {
  title: string;
  emoji: string;
  type: "tech" | "idea";
  topics: string[];
  published: boolean;
}

export function formatForQiita(
  article: GeneratedArticle,
  isPrivate = false,
): QiitaPayload {
  const orgName = config.qiita.organizationName();
  return {
    title: article.title,
    body: article.body,
    tags: getQiitaTags(article.keywords).map((name) => ({ name })),
    private: isPrivate,
    ...(orgName ? { organization_url_name: orgName } : {}),
  };
}

const TOPIC_MAP: Record<string, string> = {
  ai: "ai", llm: "llm", gpt: "gpt", claude: "claude", gemini: "gemini",
  機械学習: "machinelearning", rag: "rag", プロンプト: "prompt",
  python: "python", typescript: "typescript", openai: "openai",
  langchain: "langchain", データ: "data", 自動化: "automation",
  エージェント: "agent", ファインチューニング: "finetuning",
  ses: "ses", エンジニア: "engineer", フリーランス: "freelance",
  キャリア: "career", 転職: "career", 開発: "development",
  docker: "docker", github: "github", aws: "aws", terraform: "terraform",
  react: "react", nextjs: "nextjs", vscode: "vscode",
  copilot: "githubcopilot", cursor: "cursor", mcp: "mcp",
  dify: "dify", n8n: "n8n", crewai: "crewai", autogen: "autogen",
};

function toEnglishTopics(keywords: string[]): string[] {
  const topics = new Set<string>();
  for (const kw of keywords) {
    const lower = kw.toLowerCase().replace(/\s+/g, "");
    for (const [jp, en] of Object.entries(TOPIC_MAP)) {
      if (lower.includes(jp)) { topics.add(en); break; }
    }
    if (topics.size >= 5) break;
  }
  if (topics.size === 0) topics.add("ai");
  return [...topics].slice(0, 5);
}

export function formatForZenn(
  article: GeneratedArticle,
  published = true,
): string {
  const topics = toEnglishTopics(article.keywords);

  const frontmatter: ZennFrontmatter = {
    title: article.title.slice(0, 60),
    emoji: "🤖",
    type: "tech",
    topics,
    published,
  };

  const fm = Object.entries(frontmatter)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((i) => `"${i}"`).join(", ")}]`;
      if (typeof v === "boolean") return `${k}: ${v}`;
      return `${k}: "${v}"`;
    })
    .join("\n");

  return `---\n${fm}\n---\n\n${article.body}`;
}

export function formatForNote(article: GeneratedArticle): {
  title: string;
  body: string;
} {
  // Note uses plain markdown, strip any Qiita/Zenn-specific syntax
  return {
    title: article.title,
    body: article.body,
  };
}

export function formatForX(article: GeneratedArticle, articleUrl?: string): string {
  let post = article.xPost;
  if (articleUrl) {
    // Ensure URL fits within 280 chars
    const maxTextLen = 280 - articleUrl.length - 2; // 2 for newline + space
    if (post.length > maxTextLen) {
      post = post.slice(0, maxTextLen - 1) + "…";
    }
    post = `${post}\n${articleUrl}`;
  }
  return post;
}

export function generateZennSlug(title: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const slug = title
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 30);
  return `${date}-${slug || "ai-article"}`;
}
