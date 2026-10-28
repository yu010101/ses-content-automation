// 2026-10-28: Zenn は前の公開から24時間たつまで次の記事を公開しない（push と公開時刻の突き合わせからの推定。10/18 08:08 公開 → 10/19 08:04 の push は不発 → 10/20 08:04 で公開）。
// 毎朝8時の push だと数分足りず1日おきになるので、集計記事の Zenn 版が公開待ちのまま24時間を過ぎたら、空のコミットで Zenn の反映を促す。
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import { config } from "../config.js";

const HISTORY = "data/data-article-history.json";
const USER = "ailmarketing";
const GAP_MS = (24 * 60 + 10) * 60 * 1000;
const NUDGE_EVERY_MS = 60 * 60 * 1000;

interface Run { date: string; dryRun: boolean; urls: string[] }
interface History { runs: Run[]; zennNudgedAt?: string; [k: string]: unknown }

const isLive = async (slug: string) => (await fetch(`https://zenn.dev/api/articles/${slug}`)).status === 200;

export async function runZennNudge() {
  const history = JSON.parse(readFileSync(HISTORY, "utf-8")) as History;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const slugs = history.runs
    .filter((r) => !r.dryRun && r.date >= weekAgo)
    .flatMap((r) => r.urls.map((u) => u.match(/zenn\.dev\/[^/]+\/articles\/([\w-]+)/)?.[1]).filter((s): s is string => !!s));
  const pending: string[] = [];
  for (const s of slugs) if (!(await isLive(s))) pending.push(s);
  if (!pending.length) return console.log("[zenn-nudge] 公開待ちなし");

  const list = (await (await fetch(`https://zenn.dev/api/articles?username=${USER}&order=latest`)).json()) as { articles: { published_at: string }[] };
  const last = Math.max(...list.articles.map((a) => Date.parse(a.published_at)));
  const now = Date.now();
  if (now - last < GAP_MS) return console.log(`[zenn-nudge] 公開待ち ${pending.join(",")}。前の公開 ${new Date(last).toISOString()} から24時間たっていない`);
  if (history.zennNudgedAt && now - Date.parse(history.zennNudgedAt) < NUDGE_EVERY_MS) return console.log("[zenn-nudge] 直近1時間に促し済み");

  const dir = join(tmpdir(), `zenn-nudge-${now}`);
  try {
    await simpleGit().clone(`https://x-access-token:${config.zenn.githubToken()}@github.com/${config.zenn.repo}.git`, dir, ["--depth", "1"]);
    const g = simpleGit(dir);
    await g.addConfig("user.name", "ses-content-bot");
    await g.addConfig("user.email", "bot@ses-content-automation.local");
    await g.commit(`Zenn の公開待ちを反映（${pending.join(", ")}）`, undefined, { "--allow-empty": null });
    await g.push("origin", "main");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  history.zennNudgedAt = new Date(now).toISOString();
  writeFileSync(HISTORY, JSON.stringify(history, null, 2), "utf-8");
  console.log(`[zenn-nudge] 空のコミットで反映を促した: ${pending.join(",")}`);
}
