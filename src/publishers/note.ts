import { formatForNote } from "../content/formatter.js";
import { isMcpAvailable, mcpCall } from "./mcp-client.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

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

    // Try MCP (note-com-mcp) first
    if (await isMcpAvailable()) {
      return this.publishViaMcp(title, body);
    }

    // Fallback: output for OpenClaw browser automation
    const payload = JSON.stringify({ action: "note_publish", title, body });
    console.log(`[Note] OPENCLAW_BROWSER_ACTION:${payload}`);
    console.log(`[Note] Delegated to OpenClaw browser automation`);
    return {
      platform: this.platform,
      success: true,
      url: "(pending-browser-automation)",
    };
  }

  private async publishViaMcp(title: string, body: string): Promise<PublishResult> {
    try {
      console.log("[Note] Publishing via MCP (note-com-mcp)...");
      const result = await mcpCall("post-draft-note", {
        title,
        body,
      });
      console.log(`[Note] MCP result:`, JSON.stringify(result).slice(0, 200));
      return { platform: this.platform, success: true, url: "(draft-via-mcp)" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { platform: this.platform, success: false, error: `MCP: ${message}` };
    }
  }
}
