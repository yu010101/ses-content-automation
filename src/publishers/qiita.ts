import { config } from "../config.js";
import { formatForQiita } from "../content/formatter.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { IPublisher, PublishResult } from "./types.js";

export class QiitaPublisher implements IPublisher {
  platform = "qiita";

  async publish(
    article: GeneratedArticle,
    dryRun = false,
  ): Promise<PublishResult> {
    const payload = formatForQiita(article, dryRun);

    if (dryRun) {
      console.log(`[Qiita] DRY RUN - Would publish: "${article.title}"`);
      console.log(`[Qiita] Tags: ${payload.tags.map((t) => t.name).join(", ")}`);
      console.log(`[Qiita] Body length: ${payload.body.length} chars`);
      return { platform: this.platform, success: true, url: "(dry-run)" };
    }

    const res = await fetch(`${config.qiita.baseUrl}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.qiita.accessToken()}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      return { platform: this.platform, success: false, error: `${res.status}: ${err}` };
    }

    const data = (await res.json()) as { url: string };
    console.log(`[Qiita] Published: ${data.url}`);
    return { platform: this.platform, success: true, url: data.url };
  }
}
