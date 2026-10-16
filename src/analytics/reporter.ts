import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { PerformanceSnapshot } from "./collector.js";
import type { LearningState } from "./feedback.js";

interface TelegramMessage {
  text: string;
  parse_mode: "MarkdownV2" | "HTML";
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

export async function sendDailyReport(): Promise<void> {
  const botToken = config.telegram.botToken();
  const chatId = config.telegram.chatId();

  // Load performance data
  let snapshot: PerformanceSnapshot;
  try {
    snapshot = JSON.parse(
      readFileSync(join(process.cwd(), "data/performance.json"), "utf-8"),
    );
  } catch {
    console.log("  No performance data for report");
    return;
  }

  // Load learning state
  let learning: LearningState | null = null;
  try {
    learning = JSON.parse(
      readFileSync(join(process.cwd(), "data/learning-state.json"), "utf-8"),
    );
  } catch {
    // Learning state is optional
  }

  // Report observations and coverage without cross-platform ranking.
  let report = `<b>SES Content Observations</b>\n`;
  report += `Observed: ${escapeHtml(snapshot.collectedAt)}\n`;
  report += `Ledger/observed records: ${snapshot.summary.recordCount ?? snapshot.articles.length}\n`;
  const platforms = snapshot.summary.platforms;
  if (platforms) {
    report += `Qiita measured views (${platforms.qiita.measuredViews}/${platforms.qiita.articles}): ${platforms.qiita.views ?? "unmeasured"}\n`;
    report += `Qiita likes: ${platforms.qiita.likes ?? "unmeasured"}; stocks: ${platforms.qiita.stocks ?? "unmeasured"}\n`;
    report += `Zenn likes (${platforms.zenn.articles} records): ${platforms.zenn.likes ?? "unmeasured"}\n`;
    report += `note: ${platforms.note.urlRecords} URLs, reactions unmeasured\n`;
  } else {
    report += "Legacy snapshot: platform coverage unavailable; refresh analytics.\n";
  }
  report += "Cumulative observations; no causal/viral ranking.\n";

  if (learning && learning.recommendations.length > 0) {
    report += `\n<b>Tomorrow's Recommendations</b>\n`;
    for (const rec of learning.recommendations.slice(0, 3)) {
      report += `- ${escapeHtml(rec)}\n`;
    }
  }

  // Send via Telegram
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: report,
      parse_mode: "HTML",
    } satisfies { chat_id: string; text: string; parse_mode: string }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${body}`);
  }

  console.log("  Daily report sent to Telegram");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
