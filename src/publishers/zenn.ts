import { simpleGit } from "simple-git";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { formatForZenn, generateZennSlug } from "../content/formatter.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

const ZENN_REPO = "yu010101/ai-lab-zenn";
const ZENN_USER = "ailmarketing";

export class ZennPublisher implements IPublisher {
  platform = "zenn";

  async publish(
    article: GeneratedArticle,
    dryRun = false,
  ): Promise<PublishResult> {
    const slug = generateZennSlug(article.title);
    const content = formatForZenn(article, true);

    if (dryRun) {
      console.log(`[Zenn] DRY RUN - Slug: ${slug}`);
      console.log(`[Zenn] Content length: ${content.length} chars`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    try {
      // Clone the Zenn repo to a temp dir, add article, push
      const tmpDir = join(tmpdir(), `zenn-${Date.now()}`);
      console.log(`[Zenn] Cloning ${ZENN_REPO}...`);
      const git = simpleGit();
      await git.clone(`https://github.com/${ZENN_REPO}.git`, tmpDir);

      const repoGit = simpleGit(tmpDir);
      const articlesDir = join(tmpDir, "articles");
      mkdirSync(articlesDir, { recursive: true });

      const filePath = join(articlesDir, `${slug}.md`);
      writeFileSync(filePath, content, "utf-8");
      console.log(`[Zenn] Wrote article: ${slug}.md`);

      await repoGit.add(filePath);
      await repoGit.commit(`Add AI article: ${article.title}`);
      await repoGit.push("origin", "main");

      const url = `https://zenn.dev/${ZENN_USER}/articles/${slug}`;
      console.log(`[Zenn] Pushed to ${ZENN_REPO}: ${url}`);
      return { platform: this.platform, success: true, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { platform: this.platform, success: false, error: message };
    }
  }
}
