import { simpleGit } from "simple-git";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { config } from "../config.js";
import { formatForZenn, generateZennSlug } from "../content/formatter.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

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

    const token = config.zenn.githubToken();
    const repo = config.zenn.repo;
    const cloneUrl = `https://x-access-token:${token}@github.com/${repo}.git`;
    const tmpDir = join(tmpdir(), `zenn-${Date.now()}`);

    try {
      console.log(`[Zenn] Cloning ${repo}...`);
      const git = simpleGit();
      await git.clone(cloneUrl, tmpDir);

      const repoGit = simpleGit(tmpDir);
      await repoGit.addConfig("user.name", "ses-content-bot");
      await repoGit.addConfig("user.email", "bot@ses-content-automation.local");

      const articlesDir = join(tmpDir, "articles");
      mkdirSync(articlesDir, { recursive: true });

      const filePath = join(articlesDir, `${slug}.md`);
      writeFileSync(filePath, content, "utf-8");
      console.log(`[Zenn] Wrote article: ${slug}.md`);

      await repoGit.add(filePath);
      await repoGit.commit(`Add AI article: ${article.title}`);
      await repoGit.push("origin", "main");

      const url = `https://zenn.dev/${config.zenn.user}/articles/${slug}`;
      console.log(`[Zenn] Pushed to ${repo}: ${url}`);
      return { platform: this.platform, success: true, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { platform: this.platform, success: false, error: message };
    } finally {
      // Clean up temp directory
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
