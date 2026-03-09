import { simpleGit } from "simple-git";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { formatForZenn, generateZennSlug } from "../content/formatter.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

export class ZennPublisher implements IPublisher {
  platform = "zenn";

  constructor(private repoRoot: string = process.cwd()) {}

  async publish(
    article: GeneratedArticle,
    dryRun = false,
  ): Promise<PublishResult> {
    const slug = generateZennSlug(article.title);
    const content = formatForZenn(article);
    const articlesDir = join(this.repoRoot, config.zenn.articlesDir);
    const filePath = join(articlesDir, `${slug}.md`);

    if (dryRun) {
      console.log(`[Zenn] DRY RUN - Would create: ${filePath}`);
      console.log(`[Zenn] Slug: ${slug}`);
      console.log(`[Zenn] Content length: ${content.length} chars`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    try {
      mkdirSync(articlesDir, { recursive: true });
      writeFileSync(filePath, content, "utf-8");
      console.log(`[Zenn] Wrote article: ${filePath}`);

      // In CI, the workflow handles git add/commit/push
      if (process.env.CI) {
        const url = `https://zenn.dev/articles/${slug}`;
        console.log(`[Zenn] CI mode - file written, git push handled by workflow`);
        return { platform: this.platform, success: true, url };
      }

      // Local: git commit and push directly
      const git = simpleGit(this.repoRoot);
      await git.add(filePath);
      await git.commit(`Add article: ${article.title}`);
      await git.push("origin", "main");

      const url = `https://zenn.dev/articles/${slug}`;
      console.log(`[Zenn] Published: ${url}`);
      return { platform: this.platform, success: true, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { platform: this.platform, success: false, error: message };
    }
  }
}
