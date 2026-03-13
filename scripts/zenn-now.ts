import { discoverTrends } from "../src/trends/grok.js";
import { generateArticle, generateZennVariation } from "../src/content/generator.js";
import { formatForZenn, generateZennSlug } from "../src/content/formatter.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { simpleGit } from "simple-git";

async function main() {
  console.log("Generating Zenn AI article (bypass rate limit)...");

  const trends = await discoverTrends().catch(() => []);
  const keywords = ["AI", "LLM", "機械学習", "エンジニア", "プロンプトエンジニアリング", "RAG", "自動化"];
  const article = await generateArticle(trends, keywords);
  const zennArticle = await generateZennVariation(article);
  const slug = generateZennSlug(zennArticle.title);
  const content = formatForZenn(zennArticle, true); // published: true
  const articlesDir = join(process.cwd(), "articles");
  const filePath = join(articlesDir, `${slug}.md`);

  mkdirSync(articlesDir, { recursive: true });
  writeFileSync(filePath, content, "utf-8");
  console.log(`Wrote: ${filePath}`);

  // Git commit and push
  const git = simpleGit(process.cwd());
  await git.add(filePath);
  await git.commit(`Add Zenn AI article: ${zennArticle.title}`);
  await git.push("origin", "master");
  console.log(`Pushed! https://zenn.dev/ailmarketing/articles/${slug}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
