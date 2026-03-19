import { formatForNote } from "../content/formatter.js";
import { NoteClient, markdownToNoteHtml } from "./note-client.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

// Article types that should be published as paid on Note
const PAID_ARTICLE_TYPES = ["data-analysis", "howto"];
const PAID_PRICE = 300; // yen

// Extract hashtags from keywords
function toHashtags(keywords: string[]): string[] {
  const tags = keywords
    .slice(0, 5)
    .map((k) => k.replace(/\s+/g, ""));
  // Always include SES
  if (!tags.some((t) => t.includes("SES"))) tags.unshift("SES");
  return tags.slice(0, 5);
}

export class NotePublisher implements IPublisher {
  platform = "note";

  async publish(
    article: GeneratedArticle,
    dryRun = false,
  ): Promise<PublishResult> {
    const { title, body } = formatForNote(article);
    const isPaid = PAID_ARTICLE_TYPES.includes(article.articleType);
    const htmlBody = markdownToNoteHtml(body);
    const hashtags = toHashtags(article.keywords);

    if (dryRun) {
      console.log(`[Note] DRY RUN - Would publish: "${title}"`);
      console.log(
        `[Note] Type: ${isPaid ? `有料 (${PAID_PRICE}円)` : "無料"}`,
      );
      console.log(`[Note] HTML length: ${htmlBody.length} chars`);
      console.log(`[Note] Hashtags: ${hashtags.join(", ")}`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    const client = new NoteClient();
    try {
      const url = await client.createAndPublish(title, htmlBody, {
        hashtags,
        isPaid,
        price: isPaid ? PAID_PRICE : 0,
      });

      // Detect draft-publish-failed fallback URL
      if (url.includes("status=draft-publish-failed")) {
        const cleanUrl = url.replace("?status=draft-publish-failed", "");
        console.log(`[Note] Browser publish failed, draft available at: ${cleanUrl}`);
        return {
          platform: this.platform,
          success: false,
          url: cleanUrl,
          error: "Browser automation failed to click publish button. Draft was saved - publish manually.",
        };
      }

      return { platform: this.platform, success: true, url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Note] Error: ${message}`);
      return { platform: this.platform, success: false, error: message };
    } finally {
      await client.close();
    }
  }
}
