import { config } from "../config.js";
import type { GeneratedArticle } from "../content/generator.js";

const TELEGRAM_API = "https://api.telegram.org";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function telegramRequest(method: string, body: Record<string, unknown>): Promise<any> {
  const url = `${TELEGRAM_API}/bot${config.telegram.botToken()}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function sendApprovalRequest(article: GeneratedArticle): Promise<void> {
  const preview = article.body.slice(0, 500) + "...";
  const message = `📝 *新しい記事ドラフト*

*タイトル:* ${escapeMarkdown(article.title)}

*キーワード:* ${article.keywords.join(", ")}

*プレビュー:*
${escapeMarkdown(preview)}

*Xポスト:*
${escapeMarkdown(article.xPost)}

---
承認: /approve
却下: /reject`;

  await telegramRequest("sendMessage", {
    chat_id: config.telegram.chatId(),
    text: message,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ 承認", callback_data: "approve" },
          { text: "❌ 却下", callback_data: "reject" },
        ],
      ],
    },
  });
}

export async function waitForApproval(timeoutMs = 30 * 60 * 1000): Promise<boolean> {
  const chatId = config.telegram.chatId();
  let offset = 0;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const data = await telegramRequest("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["callback_query"],
    });

    for (const update of data.result) {
      offset = update.update_id + 1;

      if (update.callback_query?.data === "approve") {
        await telegramRequest("answerCallbackQuery", {
          callback_query_id: (update as Record<string, unknown>).callback_query,
        });
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: "✅ 承認しました。投稿を開始します...",
        });
        return true;
      }

      if (update.callback_query?.data === "reject") {
        await telegramRequest("sendMessage", {
          chat_id: chatId,
          text: "❌ 却下しました。記事は投稿されません。",
        });
        return false;
      }
    }
  }

  console.log("[Telegram] Approval timeout reached");
  return false;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}
