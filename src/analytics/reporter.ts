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

  // Build report
  const top3 = snapshot.articles.slice(0, 3);
  const bottom = snapshot.articles.length > 0
    ? snapshot.articles[snapshot.articles.length - 1]
    : null;

  let report = `<b>SES Content Daily Report</b>\n`;
  report += `<i>${new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}</i>\n\n`;

  report += `<b>Summary</b>\n`;
  report += `Articles: ${snapshot.summary.totalArticles}\n`;
  report += `Views: ${snapshot.summary.totalViews}\n`;
  report += `Likes: ${snapshot.summary.totalLikes}\n`;
  report += `Stocks: ${snapshot.summary.totalStocks}\n\n`;

  report += `<b>Top 3</b>\n`;
  for (let i = 0; i < top3.length; i++) {
    const a = top3[i];
    const q = a.platforms.qiita;
    report += `${i + 1}. ${escapeHtml(a.title)}\n`;
    if (q) {
      report += `   ${q.views}v / ${q.likes}L / ${q.stocks}S\n`;
    }
  }

  if (bottom && snapshot.articles.length > 3) {
    report += `\n<b>Lowest Performer</b>\n`;
    report += `${escapeHtml(bottom.title)}\n`;
    const bq = bottom.platforms.qiita;
    if (bq) {
      report += `${bq.views}v / ${bq.likes}L / ${bq.stocks}S\n`;
    }
  }

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
