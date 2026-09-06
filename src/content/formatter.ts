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

/**
 * Build CTA with UTM tracking params for the FreelanceDB registration link.
 * platform: qiita / zenn / note / x — used as utm_source
 * slug: article slug — used as utm_campaign for per-article CV attribution
 */
function buildFreelanceCta(platform: string, slug: string): string {
  const utm = `?utm_source=${encodeURIComponent(platform)}&utm_medium=article&utm_campaign=${encodeURIComponent(slug)}`;
  const url = `https://radineer.asia/freelance/register${utm}`;
  return `

---

## 💼 フリーランスエンジニアの案件をお探しですか？

**SES解体新書 フリーランスDB**では、高単価案件を多数掲載中です。

- ✅ マージン率公開で透明な取引
- ✅ AI/クラウド/Web系の厳選案件
- ✅ 専任コーディネーターが単価交渉をサポート

▶ **[無料でエンジニア登録する](${url})**

`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\u3040-\u30ff\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function formatForQiita(
  article: GeneratedArticle,
  isPrivate = false,
): QiitaPayload {
  const orgName = config.qiita.organizationName();
  const bodyWithCta = article.body + buildFreelanceCta("qiita", slugify(article.title));
  return {
    title: article.title,
    body: bodyWithCta,
    tags: getQiitaTags(article.keywords).map((name) => ({ name })),
    private: isPrivate,
    ...(orgName ? { organization_url_name: orgName } : {}),
  };
}

// 2026-09-06 実測で並べ替え。照合は最初の一致で break するので**順序が結果**。
// 旧版は "Claude Code" が必ず claude に落ち、claudecode(Zenn 13,624件)へ一度も載らなかった
// (実測: 自社51本中22本のタイトルに Claude Code とあるのに claudecode トピックは0本)。
// 汎用の ai は何にでも当たるので最後に置く。
const TOPIC_MAP: Record<string, string> = {
  claudecode: "claudecode", "claude code": "claudecode",
  生成ai: "生成ai", aiエージェント: "aiagent",
  cursor: "cursor", copilot: "githubcopilot", mcp: "mcp",
  claude: "claude", gpt: "gpt", gemini: "gemini", openai: "openai",
  llm: "llm", rag: "rag", プロンプト: "prompt", 個人開発: "個人開発",
  機械学習: "machinelearning", ファインチューニング: "finetuning",
  langchain: "langchain", dify: "dify", n8n: "n8n",
  crewai: "crewai", autogen: "autogen", エージェント: "agent",
  python: "python", typescript: "typescript", react: "react",
  nextjs: "nextjs", docker: "docker", github: "github",
  aws: "aws", terraform: "terraform", vscode: "vscode",
  自動化: "automation", 開発: "development",
  ses: "ses", エンジニア: "engineer", フリーランス: "freelance",
  キャリア: "career", 転職: "career", データ: "data",
  ai: "ai",
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
  crossLinks?: { qiitaUrl?: string },
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

  let body = article.body + buildFreelanceCta("zenn", slugify(article.title));

  // Add cross-platform link for Zenn
  if (crossLinks?.qiitaUrl) {
    body += `\nQiitaでコード付き解説も公開しています: ${crossLinks.qiitaUrl}`;
  }

  return `---\n${fm}\n---\n\n${body}`;
}

export function formatForNote(article: GeneratedArticle, crossLinks?: { qiitaUrl?: string; zennUrl?: string }): {
  title: string;
  body: string;
} {
  let body = article.body + buildFreelanceCta("note", slugify(article.title));

  // Add cross-platform links at the end
  if (crossLinks) {
    const links: string[] = [];
    if (crossLinks.qiitaUrl) {
      links.push(`技術的な詳細はQiitaでも解説しています: ${crossLinks.qiitaUrl}`);
    }
    if (crossLinks.zennUrl) {
      links.push(`Zennでも記事を公開中: ${crossLinks.zennUrl}`);
    }
    if (links.length > 0) {
      body += `\n\n---\n\n${links.join("\n\n")}`;
    }
  }

  return {
    title: article.title,
    body,
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
