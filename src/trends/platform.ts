import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import type { TrendResult } from "./grok.js";

/**
 * 投稿先プラットフォームの実トレンドを取得する。
 *
 * 2026-09-06: Grok(x.ai)が 403 "used all available credits" で死んでおり、
 * pipeline の Step1/1.5 は try/catch に握られて**トレンド入力ゼロのまま**
 * 記事を作り続けていた。x.ai は有料・与信切れなので、
 * 投稿先そのもの(Zenn/Qiita)の公開APIに差し替える。認証不要・無料。
 *
 * 実測(2026-09-06): Qiita 直近2週でストック20超の記事の頻出タグは
 *   生成AI(5) AI(3) AIエージェント(2) ClaudeCode(2) 初心者(2) LLM(2)
 * 取得結果は data/trends/ に日付つきで保存する。
 * 保存しないと「トレンド由来の記事が伸びたか」を後から測れないため。
 */

const UA = "Mozilla/5.0 (compatible; ses-content-trends/1.0)";

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

interface ZennArticle { title: string; liked_count: number; path: string }
interface QiitaItem { title: string; stocks_count: number; url: string; tags: { name: string }[] }

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

export async function discoverPlatformTrends(): Promise<TrendResult[]> {
  const themes = new Map<string, { titles: string[]; weight: number }>();
  const add = (key: string, title: string, w: number) => {
    const cur = themes.get(key) ?? { titles: [], weight: 0 };
    if (cur.titles.length < 3) cur.titles.push(title);
    cur.weight += w;
    themes.set(key, cur);
  };

  // 片方が落ちてももう片方は使う。全滅した時だけ throw する。
  // (Zenn API は叩きすぎると 429 を返す。それで Qiita 側まで捨てるのは損)
  const failures: string[] = [];

  // Zenn の日次トレンド(いいね数つき)
  try {
    const zenn = (await getJson("https://zenn.dev/api/articles?order=daily&count=30")) as {
      articles?: ZennArticle[];
    };
    for (const a of zenn.articles ?? []) {
      add(a.title, a.title, Math.max(1, a.liked_count) / 10);
    }
  } catch (e) {
    failures.push(`zenn: ${e instanceof Error ? e.message : e}`);
  }

  // Qiita: 直近2週間でストックが伸びた記事 -> タグ頻度をテーマとして使う
  const q = encodeURIComponent(`created:>=${daysAgo(14)} stocks:>20`);
  let qiita: QiitaItem[] = [];
  try {
    qiita = (await getJson(
      `https://qiita.com/api/v2/items?per_page=30&query=${q}`,
    )) as QiitaItem[];
  } catch (e) {
    failures.push(`qiita: ${e instanceof Error ? e.message : e}`);
  }
  const tagCount = new Map<string, { n: number; titles: string[] }>();
  for (const it of qiita ?? []) {
    for (const t of it.tags ?? []) {
      const cur = tagCount.get(t.name) ?? { n: 0, titles: [] };
      cur.n += 1;
      if (cur.titles.length < 3) cur.titles.push(it.title);
      tagCount.set(t.name, cur);
    }
  }

  if (failures.length === 2) {
    // 両方落ちた = 取得できていない。0件を「トレンド無し」と偽らない。
    throw new Error(`全ソース取得失敗 (${failures.join(" / ")})`);
  }
  if (failures.length) console.log(`  一部取得できず: ${failures.join(" / ")}`);

  const results: TrendResult[] = [];
  for (const [tag, v] of [...tagCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6)) {
    results.push({
      topic: tag,
      summary: `Qiitaで直近14日にストック20超の記事${v.n}本がこのタグを付けている`,
      tweetExamples: v.titles,
      relevanceScore: Math.min(1, v.n / 5),
    });
  }
  for (const [title, v] of [...themes.entries()].sort((a, b) => b[1].weight - a[1].weight).slice(0, 4)) {
    results.push({
      topic: title,
      summary: `Zennの日次トレンド上位(いいね換算 ${(v.weight * 10).toFixed(0)})`,
      tweetExamples: v.titles,
      relevanceScore: Math.min(1, v.weight / 10),
    });
  }

  try {
    const dir = join(process.cwd(), "data", "trends");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${daysAgo(0)}.json`),
      JSON.stringify({ at: new Date().toISOString(), source: "zenn+qiita", results }, null, 1),
    );
  } catch {
    // 保存できなくてもトレンド自体は返す
  }
  return results;
}
