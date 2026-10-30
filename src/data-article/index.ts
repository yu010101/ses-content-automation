// 2026-10-28 本人決定「毎日、実データの集計＋図に切り替える」。
// FreelanceDB の掲載中案件の集計値（公開API）から、1日1つの切り口で表と図の記事を作り、note・Qiita・Zenn に出す。
// 数字と図はコードで作る。LLM は地の文だけ書き、本文の数字は出典ゲート（--facts）で集計値と照合して、違えば出さない。
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import { config } from "../config.js";
import { claudeCli } from "../utils/claude-cli.js";
import { assertSources } from "../utils/source-gate.js";
import { NotePublisher } from "../publishers/note.js";
import { QiitaPublisher } from "../publishers/qiita.js";
import { ZennPublisher } from "../publishers/zenn.js";
import { recordPublished } from "../pipeline.js";
import type { GeneratedArticle } from "../content/generator.js";
import type { PublishResult } from "../publishers/types.js";
import { pickCut, type CutResult, type MarketStats } from "./cuts.js";
import { renderPng, renderEyecatch, renderCover, type ChartSpec } from "./chart.js";

const STATS_URL = "https://freelance.radineer.asia/api/public/market-stats";
const HISTORY = "data/data-article-history.json";
const SNAP_DIR = "data/market-snapshots";
const OUT_DIR = "logs/data-article";

interface History { lastUsed: Record<string, string>; runs: { date: string; cut: string; title: string; dryRun: boolean; urls: string[] }[] }

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

function loadHistory(): History {
  try { return JSON.parse(readFileSync(HISTORY, "utf-8")); } catch { return { lastUsed: {}, runs: [] }; }
}

async function fetchStats(): Promise<MarketStats> {
  const res = await fetch(STATS_URL, { headers: { "User-Agent": "sescore-data-article" } });
  if (!res.ok) throw new Error(`market-stats ${res.status}`);
  const s = (await res.json()) as MarketStats;
  if (!s.total || !Array.isArray(s.bySkill)) throw new Error("market-stats の形が想定と違う");
  return s;
}

const mdTable = (t: CutResult["table"]) =>
  [`| ${t.head.join(" | ")} |`, `|${t.head.map(() => "---").join("|")}|`, ...t.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

type Target = "qiita" | "zenn" | "note";

const man = (v: number) => `${+(v / 10000).toFixed(1)}万円`;

/** 要点の図。図に描いた行の値だけから、目を引く数字を3つ選ぶ */
function highlights(c: ChartSpec): ChartSpec | null {
  const head = { kind: "kpi" as const, title: "要点", subtitle: c.title };
  if (c.kind === "dumbbell") {
    const d = c.rows.map((r) => ({ ...r, d: r.a - r.b }));
    const hi = d.reduce((m, r) => (r.d > m.d ? r : m), d[0]);
    const lo = d.reduce((m, r) => (r.d < m.d ? r : m), d[0]);
    const items = [];
    if (hi.d > 0) items.push({ label: `${c.legend[0]}が最も高い`, value: `+${man(hi.d)}`, note: `${hi.label}: ${c.legend[0]} ${man(hi.a)}・${c.legend[1]} ${man(hi.b)}` });
    if (lo.d < 0) items.push({ label: `${c.legend[1]}が最も高い`, value: `+${man(-lo.d)}`, note: `${lo.label}: ${c.legend[1]} ${man(lo.b)}・${c.legend[0]} ${man(lo.a)}` });
    items.push({ label: "差がない", value: `${d.filter((r) => r.d === 0).length}つ`, note: `図の${d.length}行のうち、中央値が同じ` });
    return { ...head, items };
  }
  if (c.kind === "range") {
    const top = c.rows.reduce((m, r) => (r.median > m.median ? r : m), c.rows[0]);
    const low = c.rows.reduce((m, r) => (r.median < m.median ? r : m), c.rows[0]);
    const wide = c.rows.reduce((m, r) => (r.hi - r.lo > m.hi - m.lo ? r : m), c.rows[0]);
    return { ...head, items: [
      { label: "中央値が最も高い", value: man(top.median), note: `${top.label}（${top.note}）` },
      { label: "中央値が最も低い", value: man(low.median), note: `${low.label}（${low.note}）` },
      { label: "真ん中の半分が最も広い", value: man(wide.hi - wide.lo), note: `${wide.label}: ${man(wide.lo)}〜${man(wide.hi)}` },
    ] };
  }
  if (c.kind === "stack") {
    const share = (r: (typeof c.rows)[number], k: number[]) => k.reduce((a, i) => a + r.parts[i], 0) / (r.parts.reduce((a, b) => a + b, 0) || 1);
    const by = (k: number[], dir: 1 | -1) => c.rows.reduce((m, r) => (dir * (share(r, k) - share(m, k)) > 0 ? r : m), c.rows[0]);
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const top = by([0, 1], 1), low = by([0, 1], -1), full = by([0], 1);
    return { ...head, items: [
      { label: `${c.legend[0]}か${c.legend[1]}が最も多い`, value: pct(share(top, [0, 1])), note: `${top.label}（${top.note}）` },
      { label: `${c.legend[0]}か${c.legend[1]}が最も少ない`, value: pct(share(low, [0, 1])), note: `${low.label}（${low.note}）` },
      { label: `${c.legend[0]}だけで最も多い`, value: pct(share(full, [0])), note: `${full.label}（${full.note}）` },
    ] };
  }
  if (c.kind === "bars") {
    const top = [...c.rows].sort((a, b) => b.value - a.value).slice(0, 3);
    return { ...head, items: top.map((r, i) => ({ label: `${i + 1}番目に多い`, value: r.valueLabel, note: r.label })) };
  }
  return null;
}

/** 図の見出し: 図に描いた行だけから、コードで結論の一文を作る（LLM に任せると図と別の数字を見出しにした 2026-10-28） */
function chartHeading(c: ChartSpec): string {
  if (c.kind === "dumbbell") {
    const up = c.rows.filter((r) => r.a > r.b).length, down = c.rows.filter((r) => r.a < r.b).length;
    return `${c.rows.length}スキル中、${c.legend[0]}が高いのは${up}、${c.legend[1]}が高いのは${down}`;
  }
  if (c.kind === "range") {
    const top = c.rows.reduce((m, r) => (r.median > m.median ? r : m), c.rows[0]);
    const low = c.rows.reduce((m, r) => (r.median < m.median ? r : m), c.rows[0]);
    if (top.median === low.median) return `中央値はどの行も${man(top.median)}で同じ`;
    return `中央値は${top.label}の${man(top.median)}が最も高く、${low.label}の${man(low.median)}が最も低い`;
  }
  if (c.kind === "stack") {
    const share = (r: (typeof c.rows)[number]) => (r.parts[0] + r.parts[1]) / (r.parts.reduce((a, b) => a + b, 0) || 1);
    const top = c.rows.reduce((m, r) => (share(r) > share(m) ? r : m), c.rows[0]);
    const low = c.rows.reduce((m, r) => (share(r) < share(m) ? r : m), c.rows[0]);
    return `リモート可の割合は${top.label}が最も高く、${low.label}が最も低い`;
  }
  if (c.kind === "bars") {
    const top = [...c.rows].sort((a, b) => b.value - a.value)[0];
    return `最も多いのは${top.label}の${top.valueLabel}`;
  }
  return c.title;
}

/** 図解: 何件からどう絞り、どう分けて何を出したか */
function flow(cut: CutResult, stats: MarketStats): ChartSpec {
  const steps = [{ value: `${stats.total}件`, label: "掲載中・募集中の案件" }];
  if (cut.method[1].includes("中央値") || cut.id === "rate-bands") steps.push({ value: `${stats.overall.n}件`, label: "うち単価の上限あり" });
  steps.push({ value: `${cut.table.rows.length}行`, label: cut.method[0] });
  steps.push({ value: cut.method[1].includes("中央値") ? "中央値" : "件数", label: cut.method[1] });
  return { kind: "flow", title: "集計の流れ", subtitle: `${stats.asOf.slice(0, 10)} に公開APIから取得した集計値`, steps };
}

/** 本文の金額と割合（facts のうち万円・%）を太字にする。件数まで太くすると太字だらけになる。「15件」の中の「5件」のような部分一致は太字にしない */
function boldFacts(t: string, facts: string[]): string {
  const fs = facts.filter((f) => /\d(万円|%)$/.test(f)).sort((a, b) => b.length - a.length).map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!fs.length) return t;
  return t.replace(new RegExp(`(?<![\\d.*])(${fs.join("|")})(?![\\d.])`, "g"), (m, _g, off: number, all: string) => {
    // 「%」で終わる太字は、次が日本語の文字だと閉じ記号として読まれないので太字にしない
    const next = all[off + m.length] ?? "";
    return m.endsWith("%") && next && !/[\s、。，．,.)）」』：:・/／〜]/.test(next) ? m : `**${m}**`;
  });
}

/** 2026-10-30 採点（note-score-20261030）で「読者が自分の判断に使う手順と目安が薄い」（K1・K4）と出た。表の行から、自分の条件に当てはめる目安を決まった形で作る。
 * 数字は表の文字列（facts に入っている）だけを使う */
function usage(cut: CutResult): string[] {
  const { head, rows } = cut.table;
  const col = (name: string) => head.indexOf(name);
  const [lab, med, mid] = [0, col("中央値"), col("真ん中の半分")];
  if (med > 0 && mid > 0) {
    const r = rows.find((x) => x[mid].includes("〜")) ?? rows[0];
    const [lo, hi] = r[mid].split("〜");
    return [
      `表で自分の${head[lab]}の行を探します（例: ${r[lab]}）`,
      `提示された単価の上限が${lo}より低いなら、その行の真ん中の半分より下です。ほかの案件と比べてから決める目安になります`,
      `${r[med]}（中央値）前後なら真ん中、${hi}を超えるなら高い側です`,
      "件数の少ない行は、数件で中央値が動きます。目安にとどめてください",
    ];
  }
  const rc = col("リモート可");
  if (rc > 0 && col("差") > 0) {
    // 差の欄は「リモート可が15万円高い」「出社が22.5万円高い」「差なし」の文（cuts.ts の signed）
    const d = col("差");
    const amount = (v: string) => parseFloat(v.replace(/^.*が/, "")) || 0;
    const remote = rows.filter((x) => x[d].startsWith("リモート可が")).sort((a, b) => amount(b[d]) - amount(a[d]));
    const cell = (v: string) => v.replace(/（.*$/, "");
    const out = [`表で自分のスキルの行を探し、差の欄を見ます`];
    if (remote.length) {
      const r = remote[0];
      out.push(`差の欄がリモート可の側に高い行は、リモートを条件にしても単価の上限が下がりにくい行です（例: ${r[0]}はリモート可${cell(r[rc])}・出社${cell(r[col("出社")])}）`);
    }
    out.push("差の欄が出社の側に高い行は、リモートを条件にすると上限が下がりやすい行です。出社の案件も並べて比べる目安になります");
    return out;
  }
  const share = col("リモート可の割合");
  if (share > 0) {
    const r = rows[0];
    return [
      `リモートで働きたいなら、割合の高い行から探すと見つけやすくなります（例: ${r[0]}は${r[share]}）`,
      "割合の低いスキルは、出社の案件が多い行です。リモートにこだわるなら、組み合わせる別のスキルも見てください",
    ];
  }
  return [];
}

function callout(t: Target, kind: "info" | "warn", lines: string[]): string {
  const body = lines.map((l) => `- ${l}`).join("\n");
  if (t === "qiita") return `:::note ${kind}\n${body}\n:::`;
  if (t === "zenn") return `:::message${kind === "warn" ? " alert" : ""}\n${body}\n:::`;
  return lines.map((l) => `> ${l}`).join("\n");
}

interface Figures { kpi: string | null; main: string; flow: string; table: string }

const figure = (t: Target, src: string, caption: string) =>
  t === "note" ? `\n![${caption}](${src})\n` : `\n![${caption}](${src})\n*${caption}*\n`;

/** 見出しは札（「図で見る」）でなく、その節の結論の一文にする。note の手本（スキ388）の見出しが全部そうだった（2026-10-28 実測） */
interface Prose { intro: string; findings: string[]; howTo: string; headings: { findings: string; howTo: string } }

function writeProse(cut: CutResult, retryReasons?: string): Prose {
  const chartH = chartHeading(cut.chart);
  const prompt = `あなたは合同会社Radineerの編集者です。フリーランス向け案件サイト FreelanceDB に掲載中の案件を集計した記事の、地の文だけを書きます。表と数字はこちらで用意済みです。

集計の主題: ${cut.subject}

前提:
${cut.notes.map((n) => `- ${n}`).join("\n")}

表（${cut.tableHeading}）:
${mdTable(cut.table)}

守ること:
- 数字は表と前提に出てくる書き方のまま使う（例: 85万円、99件、18%）。足し引きや割り算で新しい数字を作らない。差・倍率・順位の数も自分で出さない
- 経験談・架空の人物・感想を作らない。「私たちが運営している案件サイト」の立場で、表から言えることだけを書く
- 表に無い市場全体の相場や一般論を断定しない
- 「徹底解説」「必見」「衝撃」などの煽りや誇張を使わない。です・ます調
- 15字以上のかぎかっこ「」の引用を書かない
${retryReasons ? `\n前回の下書きは次の理由で止まった。直して書き直す: ${retryReasons}\n` : ""}
出力はJSONのみ:
{"intro": "冒頭の2〜3文。1文目は題名の問いへの答えを表の数字で言い切る（意外な差や逆転があればそれを先に）。2文目で読むときの注意（単価の上限であること等）。最後の文は、読者に自分のスキルの行を表で確かめてから次の案件や単価を決めるよう促す", "findings": ["表から読めること。表の数字を1つ以上含む1文", "同", "同"], "howTo": "読者が自分の単価や案件の探し方にこの表をどう当てるか。2〜4文。表の数字を例に1つ使う", "headings": {"findings": "この記事の一番の結論を1文で。表の数字を含む。35字以内", "howTo": "読者が次にやることを1文で。35字以内"}}

見出しは「〜について」「まとめ」のような札にしない。その節を読まなくても結論がわかる文にする。
図の節の見出しは「${chartH}」に決まっている。headings.findings はこれと同じ内容（同じ行・同じ数字）にせず、表の別の行か別の比べ方から結論を出す。`;
  const raw = claudeCli(prompt);
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("文章の JSON が読めない");
  const p = JSON.parse(m[0]) as Prose;
  if (!p.intro || !Array.isArray(p.findings) || !p.howTo || !p.headings?.findings || !p.headings?.howTo) throw new Error("文章の JSON の項目が足りない");
  const bad = [
    !/\d/.test(p.intro.split("。")[0]) && "冒頭の1文目に表の数字が無い",
    !/\d/.test(p.headings.findings) && "結論の見出しに表の数字が無い",
    Object.values(p.headings).some((h) => h.length > 40) && "見出しが40字を超えている",
  ].filter(Boolean);
  if (bad.length) throw new Error(bad.join("。"));
  return p;
}

function assemble(cut: CutResult, p: Prose, figs: Figures, t: Target, next?: string): string {
  const B = (x: string) => boldFacts(x, cut.facts);
  let no = 0;
  const fig = (src: string, cap: string) => figure(t, src, `図${++no} ${cap}`);
  return [
    p.intro,
    `\n## ${p.headings.findings}\n`,
    figs.kpi ? fig(figs.kpi, `要点（${cut.chart.title}）`) : "",
    p.findings.map((f) => `- ${B(f)}`).join("\n"),
    `\n## ${chartHeading(cut.chart)}\n`,
    fig(figs.main, cut.chart.title),
    `\n## ${cut.tableHeading}\n`,
    // note は表の書式を表示しないので表も画像（Qiita・Zenn は本物の表）
    t === "note" ? fig(figs.table, cut.tableHeading) : mdTable(cut.table),
    "\n## 集計のしかた\n",
    fig(figs.flow, "集計の流れ"),
    `集計値は FreelanceDB の公開API ${STATS_URL} から${today()}に取得しました。案件ごとの単価の上限から、中央値と「真ん中の半分」（25〜75パーセンタイル、最も近い順位の値）を出しています。`,
    "\n## 対象と前提\n",
    callout(t, "info", cut.notes),
    `\n## ${p.headings.howTo}\n`,
    B(p.howTo),
    usage(cut).length ? `\n**自分の条件に当てはめる目安**\n\n${usage(cut).map((u, i) => `${i + 1}. ${B(u)}`).join("\n")}` : "",
    "\n## この集計で言えないこと\n",
    callout(t, "warn", cut.limits),
    // 2026-10-30 採点で「続きものの仕組みが見えない」（K5）。次の切り口を予告する（題名でなく主題。題名の件数は今日の facts に無い。かぎかっこで囲むと出典ゲートが引用と見て止める）
    next ? `\n## 次回\n\n毎朝8時に、掲載中の案件を1つの切り口で数えて出しています。次回は、${next}を数える予定です。自分のスキルの数字が出たときに見逃さないよう、フォローしておいてください。` : "",
  ].join("\n");
}

/** 図を Zenn のリポジトリ（公開）に置き、Qiita・Zenn から読める URL を返す */
async function pushFigures(pngs: string[]): Promise<void> {
  const dir = join(tmpdir(), `zenn-img-${Date.now()}`);
  try {
    await simpleGit().clone(`https://x-access-token:${config.zenn.githubToken()}@github.com/${config.zenn.repo}.git`, dir, ["--depth", "1"]);
    const g = simpleGit(dir);
    await g.addConfig("user.name", "ses-content-bot");
    await g.addConfig("user.email", "bot@ses-content-automation.local");
    mkdirSync(join(dir, "images", "data"), { recursive: true });
    for (const png of pngs) {
      copyFileSync(png, join(dir, "images", "data", basename(png)));
      await g.add(join("images", "data", basename(png)));
    }
    await g.commit(`Add figures: ${pngs.map((p) => basename(p)).join(", ")}`);
    await g.push("origin", "main");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function runDataArticle(flags: { dryRun?: boolean; cut?: string }) {
  const dryRun = !!flags.dryRun;
  const date = today();
  const history = loadHistory();
  if (!dryRun && history.runs.some((r) => r.date === date && !r.dryRun)) {
    console.log(`[data-article] ${date} は公開済みなので出さない`);
    return;
  }

  console.log("[1/5] 集計値を取得");
  const stats = await fetchStats();
  mkdirSync(SNAP_DIR, { recursive: true });
  writeFileSync(join(SNAP_DIR, `${date}.json`), JSON.stringify(stats), "utf-8");

  const cut = pickCut(stats, history.lastUsed, flags.cut);
  if (!cut) throw new Error("使える切り口が無い（件数不足）");
  console.log(`[2/5] 切り口: ${cut.id} / ${cut.title}`);

  const base = `${date}-${cut.id}`;
  const source = `出典: FreelanceDB 掲載中の案件（${date}時点・${stats.total}件）`;
  const kpiSpec = highlights(cut.chart);
  const tableSpec: ChartSpec = {
    kind: "table", title: cut.tableHeading, subtitle: cut.chart.kind === "dumbbell" ? `赤=${cut.chart.legend[0]}が高いスキル` : cut.chart.subtitle,
    head: cut.table.head, rows: cut.table.rows, accent: cut.chart.kind === "dumbbell" ? `${cut.chart.legend[0]}が` : undefined,
  };
  const local = {
    main: await renderPng(cut.chart, source, join(OUT_DIR, `${base}.png`)),
    kpi: kpiSpec ? await renderPng(kpiSpec, source, join(OUT_DIR, `${base}-kpi.png`)) : null,
    flow: await renderPng(flow(cut, stats), source, join(OUT_DIR, `${base}-flow.png`)),
    table: await renderPng(tableSpec, source, join(OUT_DIR, `${base}-table.png`)),
  };
  // note 用（スマホ幅で読める縦長の図）。Qiita/Zenn は横長のまま
  const mob = {
    main: await renderPng(cut.chart, source, join(OUT_DIR, `${base}-m.png`), true),
    kpi: kpiSpec ? await renderPng(kpiSpec, source, join(OUT_DIR, `${base}-kpi-m.png`), true) : null,
    flow: await renderPng(flow(cut, stats), source, join(OUT_DIR, `${base}-flow-m.png`), true),
    table: await renderPng(tableSpec, source, join(OUT_DIR, `${base}-table-m.png`), true),
  };
  const eyecatch = kpiSpec && kpiSpec.kind === "kpi"
    ? await renderCover({ kicker: `SES案件を数える ／ ${date}`, question: cut.title.split("。")[0], item: kpiSpec.items[0], foot: source }, join(OUT_DIR, `${base}-eyecatch.png`))
    : await renderEyecatch(cut.chart, source, join(OUT_DIR, `${base}-eyecatch.png`));
  const nextCut = pickCut(stats, { ...history.lastUsed, [cut.id]: date });
  const next = nextCut && nextCut.id !== cut.id ? nextCut.subject.replace(/（[^）]*）/g, "") : undefined;
  const raw = (p: string) => `https://raw.githubusercontent.com/${config.zenn.repo}/main/images/data/${basename(p)}`;
  const web: Figures = { main: raw(local.main), kpi: local.kpi && raw(local.kpi), flow: raw(local.flow), table: raw(local.table) };
  // note は本文の画像を公開時にアップロードする（ローカルの絶対パスを入れておき、NoteClient が差し替える）
  const noteFigs: Figures = { main: resolve(mob.main), kpi: mob.kpi && resolve(mob.kpi), flow: resolve(mob.flow), table: resolve(mob.table) };
  console.log(`[3/5] 図: ${Object.values(local).filter(Boolean).join(", ")} / 見出し画像 ${eyecatch}`);

  // 出典は集計APIと図の置き場。数字は cut.facts（表と前提に出した文字列）だけ許す
  const sources = [STATS_URL, ...Object.values(web).filter((u): u is string => !!u)];
  const targets: Target[] = ["qiita", "zenn", "note"];
  let prose: Prose | null = null;
  let reasons = "";
  for (let attempt = 1; attempt <= 3 && !prose; attempt++) {
    let p: Prose;
    try {
      p = writeProse(cut, reasons || undefined);
    } catch (e) {
      reasons = e instanceof Error ? e.message : String(e);
      continue;
    }
    const blocked = targets.map((t) => assertSources(sources, assemble(cut, p, t === "note" ? noteFigs : web, t, next), false, `data-article:${t}`, cut.facts));
    if (blocked.every(Boolean)) prose = p;
    else reasons = "本文の数字か引用が表と前提に無い。表と前提にある数字だけを使う";
  }
  if (!prose) throw new Error("出典ゲートを3回通らなかったので出さない");

  const article = (body: string, eyecatchPath?: string): GeneratedArticle => ({
    title: cut.title, body, keywords: cut.keywords, summary: prose!.intro, xPost: "", xThread: [], articleType: "data-cut", eyecatchPath,
  });
  const qiita = article(assemble(cut, prose, web, "qiita", next));
  const zenn = article(assemble(cut, prose, web, "zenn", next));
  // 2026-10-30 本人「強めの訴求で」: note の題名だけ「問い｜単価交渉の前に見る表（件数）」にする。Qiita・Zenn は検索向けの題名のまま
  const q = cut.title.split("。")[0];
  const noteTitle = cut.title.includes("。") ? `${q}｜単価交渉の前に見る表（${stats.total}件）` : cut.title;
  const note = { ...article(assemble(cut, prose, noteFigs, "note", next), eyecatch), title: noteTitle };
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [t, a] of [["qiita", qiita], ["zenn", zenn], ["note", note]] as const) writeFileSync(join(OUT_DIR, `${base}.${t}.md`), `# ${a.title}\n\n${a.body}`, "utf-8");
  console.log(`[4/5] 本文: ${join(OUT_DIR, `${base}.{qiita,zenn,note}.md`)}`);

  if (dryRun) {
    console.log("[5/5] dry-run なので公開しない");
    history.runs.push({ date, cut: cut.id, title: cut.title, dryRun: true, urls: [] });
    writeFileSync(HISTORY, JSON.stringify(history, null, 2), "utf-8");
    return;
  }

  console.log("[5/5] 公開");
  await pushFigures(Object.values(local).filter((p): p is string => !!p));
  const results: PublishResult[] = [];
  for (const [pub, a] of [[new NotePublisher(), note], [new QiitaPublisher(), qiita], [new ZennPublisher(), zenn]] as const) {
    try {
      const r = await pub.publish(a, false);
      results.push(r);
      console.log(`  ${r.success ? "OK" : "FAIL"} ${pub.platform}: ${r.url || r.error}`);
    } catch (e) {
      results.push({ platform: pub.platform, success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  recordPublished(cut.title, results);
  history.lastUsed[cut.id] = date;
  history.runs.push({ date, cut: cut.id, title: cut.title, dryRun: false, urls: results.filter((r) => r.success && r.url).map((r) => r.url!) });
  writeFileSync(HISTORY, JSON.stringify(history, null, 2), "utf-8");
  if (!results.some((r) => r.success)) process.exitCode = 1;
}
