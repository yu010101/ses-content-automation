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

この記事は、フリーランス向け案件サイト「FreelanceDB」（合同会社Radineer）の運営者が書きました。
コンサル・PMO領域の非公開案件を扱っており、希望条件を登録いただいた方に個別にご連絡しています。

[希望条件を登録する](${url})

`;
}

// 2026-10-09 外部上位(Qiita100/Zenn40/note30本)の実測: 題に【最新】【年版】【徹底】等を付ける記事は0〜5%。自社は48〜56%。
// 【】のうち年号・最新・徹底・完全・保存版を含むものだけ外す。
export function cleanTitle(title: string): string {
  return title
    .replace(/【[^】]*(?:20\d\d|最新|徹底|完全|保存版|決定版)[^】]*】/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Qiita 上位100本で登録への誘導は0%。Qiita は筆者の1行だけにする(規約 第11条1項3号 宣伝主目的の回避)
function buildAuthorLine(): string {
  return `\n\n---\n\n書いた人: 合同会社Radineer（フリーランス向け案件サイト FreelanceDB を運営）\n`;
}

const CAREER_WORDS = ["キャリア", "転職", "フリーランス", "ses", "年収", "単価", "働き方", "独立", "副業", "面談", "営業"];
function isCareerArticle(article: GeneratedArticle): boolean {
  const text = (article.title + " " + article.keywords.join(" ")).toLowerCase();
  return CAREER_WORDS.some((w) => text.includes(w));
}

// Zenn 上位40本で emoji は35種類。🤖固定(自社63/64)をやめ、トピックで選ぶ
const EMOJI_BY_TOPIC: Record<string, string> = {
  claudecode: "🧑‍💻", claude: "🧠", cursor: "🖱️", githubcopilot: "🛩️", mcp: "🔌",
  aiagent: "🕹️", agent: "🕹️", rag: "📚", llm: "💬", prompt: "✍️", python: "🐍",
  typescript: "🔷", react: "⚛️", nextjs: "▲", docker: "🐳", aws: "☁️", terraform: "🏗️",
  github: "🐙", automation: "⚙️", data: "📊", career: "🧭", freelance: "🧳", ses: "🏢",
};
function pickEmoji(topics: string[], career: boolean): string {
  if (career) return EMOJI_BY_TOPIC.career;
  for (const t of topics) if (EMOJI_BY_TOPIC[t]) return EMOJI_BY_TOPIC[t];
  return "📝";
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
  const bodyWithCta = article.body + buildAuthorLine();
  return {
    title: cleanTitle(article.title),
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

  const career = isCareerArticle(article);
  const frontmatter: ZennFrontmatter = {
    title: cleanTitle(article.title).slice(0, 60),
    emoji: pickEmoji(topics, career),
    // Zenn の定義で idea = キャリア・マネジメント等。上位のキャリア系は idea 38/40
    type: career ? "idea" : "tech",
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

  void crossLinks; // 2026-10-09: 同じ内容の重複を示す相互リンクは付けない(Zenn 規約 第4条11号)
  const body = article.body + buildFreelanceCta("zenn", slugify(article.title));

  return `---\n${fm}\n---\n\n${body}`;
}

export function formatForNote(article: GeneratedArticle, crossLinks?: { qiitaUrl?: string; zennUrl?: string }): {
  title: string;
  body: string;
} {
  void crossLinks; // 2026-10-09: 他媒体への相互リンクは付けない(同じ内容の重複になるため)
  const body = article.body + buildFreelanceCta("note", slugify(article.title));

  return {
    title: cleanTitle(article.title),
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
