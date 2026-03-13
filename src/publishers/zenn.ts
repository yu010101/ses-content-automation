import { simpleGit } from "simple-git";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { formatForZenn, generateZennSlug } from "../content/formatter.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

// Zenn publish days (0=Sun, 1=Mon, ..., 6=Sat) — limit to 2x/week to avoid ban
const ZENN_PUBLISH_DAYS = [2, 4]; // Tuesday, Thursday

export class ZennPublisher implements IPublisher {
  platform = "zenn";

  constructor(private repoRoot: string = process.cwd()) {}

  async publish(
    article: GeneratedArticle,
    dryRun = false,
  ): Promise<PublishResult> {
    // Rate limit: only publish on designated days
    const today = new Date().getDay();
    if (!ZENN_PUBLISH_DAYS.includes(today) && !dryRun) {
      console.log(
        `[Zenn] Skipping: only publishes on Tue/Thu (today is day ${today})`,
      );
      return {
        platform: this.platform,
        success: true,
        url: "(skipped-rate-limit)",
      };
    }

    const slug = generateZennSlug(article.title);
    // Save as draft (published: false) — manually publish from Zenn dashboard
    const content = formatForZenn(article, false);
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
      console.log(`[Zenn] Wrote draft article: ${filePath}`);

      // In CI, the workflow handles git add/commit/push
      if (process.env.CI) {
        const url = `https://zenn.dev/ailmarketing/articles/${slug}`;
        console.log(
          `[Zenn] CI mode - draft written, publish manually from dashboard`,
        );
        return { platform: this.platform, success: true, url };
      }

      // Local: git commit and push directly
      const git = simpleGit(this.repoRoot);
      const branch = (await git.branchLocal()).current;
      await git.add(filePath);
      await git.commit(`Add Zenn draft: ${article.title}`);
      await git.push("origin", branch);

      const url = `https://zenn.dev/ailmarketing/articles/${slug}`;
      console.log(`[Zenn] Draft pushed: ${url}`);
      console.log(
        `[Zenn] ※ 公開はZennダッシュボードから手動で行ってください`,
      );
      return { platform: this.platform, success: true, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { platform: this.platform, success: false, error: message };
    }
  }
}
