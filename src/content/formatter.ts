import { getQiitaTags } from "./templates.js";
import type { GeneratedArticle } from "./generator.js";

export interface QiitaPayload {
  title: string;
  body: string;
  tags: { name: string }[];
  private: boolean;
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
  return {
    title: article.title,
    body: article.body,
    tags: getQiitaTags(article.keywords).map((name) => ({ name })),
    private: isPrivate,
  };
}

export function formatForZenn(article: GeneratedArticle): string {
  const topics = article.keywords
    .slice(0, 5)
    .map((k) => k.replace(/\s+/g, "").toLowerCase());

  const frontmatter: ZennFrontmatter = {
    title: article.title.slice(0, 60),
    emoji: "💼",
    type: "tech",
    topics,
    published: true,
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
  return `${date}-${slug || "ses-article"}`;
}
