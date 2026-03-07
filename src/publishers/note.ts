import { formatForNote } from "../content/formatter.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

/**
 * Note publisher - delegates to OpenClaw browser automation.
 * Note does not have a public API, so we output the article
 * to stdout for OpenClaw's browser automation skill to pick up.
 */
export class NotePublisher implements IPublisher {
  platform = "note";

  async publish(
    article: GeneratedArticle,
    dryRun = false,
  ): Promise<PublishResult> {
    const { title, body } = formatForNote(article);

    if (dryRun) {
      console.log(`[Note] DRY RUN - Would publish: "${title}"`);
      console.log(`[Note] Body length: ${body.length} chars`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    // Output structured data for OpenClaw browser automation
    const payload = JSON.stringify({ action: "note_publish", title, body });
    console.log(`[Note] OPENCLAW_BROWSER_ACTION:${payload}`);
    console.log(`[Note] Delegated to OpenClaw browser automation`);

    return {
      platform: this.platform,
      success: true,
      url: "(pending-browser-automation)",
    };
  }
}
