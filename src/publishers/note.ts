import { formatForNote } from "../content/formatter.js";
import { isMcpAvailable, mcpCall } from "./mcp-client.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

// Article types that should be published as paid on Note
const PAID_ARTICLE_TYPES = ["data-analysis", "howto"];
const PAID_PRICE = 300; // yen

export class NotePublisher implements IPublisher {
  platform = "note";

  async publish(
    article: GeneratedArticle,
    dryRun = false,
  ): Promise<PublishResult> {
    const { title, body } = formatForNote(article);
    const isPaid = PAID_ARTICLE_TYPES.includes(article.articleType);

    const { freeBody, fullBody } = isPaid
      ? this.splitForPaid(body)
      : { freeBody: body, fullBody: body };

    if (dryRun) {
      console.log(`[Note] DRY RUN - Would publish: "${title}"`);
      console.log(
        `[Note] Type: ${isPaid ? `有料 (${PAID_PRICE}円)` : "無料"}`,
      );
      console.log(`[Note] Body length: ${fullBody.length} chars`);
      if (isPaid) {
        console.log(`[Note] Free preview: ${freeBody.length} chars`);
      }
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    // Try MCP (note-com-mcp) first
    if (await isMcpAvailable()) {
      return this.publishViaMcp(title, fullBody, isPaid);
    }

    // Fallback: output for browser automation
    const payload = JSON.stringify({
      action: "note_publish",
      title,
      body: fullBody,
      isPaid,
      price: isPaid ? PAID_PRICE : 0,
    });
    console.log(`[Note] OPENCLAW_BROWSER_ACTION:${payload}`);
    return {
      platform: this.platform,
      success: true,
      url: "(pending-browser-automation)",
    };
  }

  private splitForPaid(body: string): { freeBody: string; fullBody: string } {
    const lines = body.split("\n");
    const cutoff = Math.floor(lines.length * 0.4);

    let splitIndex = cutoff;
    for (let i = cutoff; i < Math.min(cutoff + 10, lines.length); i++) {
      if (lines[i].startsWith("## ")) {
        splitIndex = i;
        break;
      }
    }

    const freeLines = lines.slice(0, splitIndex);
    const freeBody = freeLines.join("\n") + `

---

**ここから先は有料記事です（${PAID_PRICE}円）**

この記事の続きでは、以下の内容を詳しく解説しています：
- より具体的なデータと分析
- 実践的なアクションプラン
- チェックリストとテンプレート

`;

    return { freeBody, fullBody: body };
  }

  private async publishViaMcp(
    title: string,
    body: string,
    isPaid: boolean,
  ): Promise<PublishResult> {
    try {
      const label = isPaid ? `有料 (${PAID_PRICE}円)` : "無料";
      console.log(`[Note] Creating draft via MCP (${label})...`);

      // Create draft via MCP (uses v1 API)
      const params: Record<string, unknown> = { title, body };
      if (isPaid) {
        params.price = PAID_PRICE;
      }

      const draftResult = await mcpCall("post-draft-note", params);
      const mcpContent = draftResult as {
        content?: Array<{ text?: string }>;
      };
      const draftText =
        mcpContent.content?.[0]?.text ?? JSON.stringify(draftResult);

      // Extract noteId from draft result
      let noteId: string | undefined;
      try {
        const parsed = JSON.parse(draftText);
        noteId = parsed.noteId ? String(parsed.noteId) : undefined;
      } catch {
        const m = draftText.match(/"noteId"\s*:\s*"?(\d+)"?/);
        noteId = m?.[1];
      }

      // Note API doesn't support direct publishing via API anymore.
      // Draft is created successfully; return the edit URL for manual publish.
      const editUrl = noteId
        ? `https://editor.note.com/notes/n${noteId}/edit/`
        : "(draft-via-mcp)";

      console.log(`[Note] Draft created: ${editUrl}`);
      console.log(
        `[Note] ※ 公開は手動で行ってください（エディタでワンクリック）`,
      );

      return {
        platform: this.platform,
        success: true,
        url: editUrl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        platform: this.platform,
        success: false,
        error: `MCP: ${message}`,
      };
    }
  }
}
