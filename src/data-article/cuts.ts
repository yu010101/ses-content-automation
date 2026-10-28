// 2026-10-28: 日次の集計記事の「切り口」。数字はすべてここで文字列にし、同じ文字列を出典ゲートの facts に入れる。
// LLM には数字を作らせない（文章だけ書かせ、本文の数字は facts と照合して違えば止める）。
// 集計値は FreelanceDB の /api/public/market-stats（SES-Core lib/public/market-stats.ts）。
import type { ChartSpec } from "./chart.js";

export interface Rates { n: number; median: number | null; p25: number | null; p75: number | null; min: number | null; max: number | null }
export interface MarketStats {
  asOf: string;
  definition: string;
  total: number;
  overall: Rates & { buckets: { label: string; count: number }[]; atLeast: Record<string, number> };
  bySkill: { skill: string; count: number; rates: Rates; remote: number; hybrid: number; onsite: number; remoteRates: Rates; onsiteRates: Rates }[];
  byWorkStyle: { key: string; label: string; count: number; rates: Rates }[];
  byStation: { station: string; count: number; rates: Rates }[];
  byRole: { key: string; label: string; count: number; rates: Rates }[];
  bySkillCount: { skills: string; count: number; rates: Rates }[];
  skillPairs: { pair: string; count: number; rates: Rates }[];
}

export interface CutResult {
  id: string;
  title: string;
  /** LLM に渡す「この記事で何を数えたか」 */
  subject: string;
  /** 図解（集計の流れ）の後半2段: どう分けたか / 何を出したか */
  method: [string, string];
  keywords: string[];
  tableHeading: string;
  table: { head: string[]; rows: string[][] };
  chart: ChartSpec;
  notes: string[];
  limits: string[];
  facts: string[];
}

/** 数字を文字列にして facts に記録する。本文の数字はこの文字列のどれかでなければ出典ゲートで止まる */
class Fmt {
  facts = new Set<string>();
  private put(s: string) { this.facts.add(s); return s; }
  /** 決まった文言の中の数字（除外の閾値など）も facts に入れる */
  fixed(s: string) { return this.put(s); }
  man(v: number | null) { return v === null ? "—" : this.put(`${+(v / 10000).toFixed(1)}万円`); }
  n(v: number) { return this.put(`${v}件`); }
  pct(part: number, whole: number) { return whole ? this.put(`${Math.round((part / whole) * 100)}%`) : "—"; }
  range(r: Rates) { return r.p25 === null || r.p75 === null ? "—" : `${this.man(r.p25)}〜${this.man(r.p75)}`; }
}

const jstDate = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const jpDate = (iso: string) => { const [y, m, d] = jstDate(iso).split("-").map(Number); return `${y}年${m}月${d}日`; };

function common(s: MarketStats, f: Fmt): string[] {
  return [
    `${jpDate(s.asOf)}時点で掲載中・募集中の案件 ${f.n(s.total)}。月額の単価の上限がわかるのは ${f.n(s.overall.n)}`,
    "値は募集に書かれた「単価の上限」。実際の契約額ではない",
    `月${f.fixed("10万円")}未満・月${f.fixed("300万円")}超は入力の誤りとして除外`,
    "すべて1つの掲載元の案件で、勤務地は東京が中心。市場全体の相場ではない",
  ];
}

const LIMITS_BASE = ["実際の契約額（ここにあるのは単価の上限）", "商流の段数（エンド直か何次請けか）", "経験年数ごとの違い（案件データに経験年数の項目がない）"];

const MIN_SPLIT = 5;

type Builder = (s: MarketStats) => CutResult | null;

/** 掲載元APIの単価帯「80」は 70万円超〜80万円以下。図と見出しで意味が取れるように書き直す */
const bandLabel = (l: string) => (l.startsWith("〜") ? `${l.slice(1)}万円以下` : l.endsWith("〜") ? `${+l.slice(0, -1) - 10}万円超` : `${+l - 9}〜${l}万円`);

const skillRates: Builder = (s) => {
  const f = new Fmt();
  const rows = s.bySkill.slice(0, 25);
  if (rows.length < 5) return null;
  const byMedian = [...rows].filter((r) => r.rates.median !== null).sort((a, b) => (b.rates.median! - a.rates.median!) || b.count - a.count);
  const notes = common(s, f);
  return {
    id: "skill-rates",
    method: ["スキルごとに分ける", "中央値と真ん中の半分を出す"],
    title: `フリーランス案件${s.total}件の単価の上限を、スキル別に集計した（${jpDate(s.asOf)}時点）`,
    subject: "スキルごとの、単価の上限の中央値と真ん中の半分（25〜75パーセンタイル）",
    keywords: ["フリーランス", "単価", "エンジニア", "データ分析", "SES"],
    tableHeading: "スキル別の単価の上限（月額・件数の多い順）",
    table: { head: ["スキル", "件数", "中央値", "真ん中の半分", "最高"], rows: rows.map((r) => [r.skill, f.n(r.count), f.man(r.rates.median), f.range(r.rates), f.man(r.rates.max)]) },
    chart: { kind: "range", title: "スキル別 単価の上限（月額）", subtitle: "件数の多い15スキル / 点=中央値 / 線=真ん中の半分", rows: byMedian.filter((r) => rows.slice(0, 15).includes(r)).map((r) => ({ label: r.skill, note: `${r.count}件`, median: r.rates.median!, lo: r.rates.p25!, hi: r.rates.p75! })) },
    notes: [...notes, `${f.fixed("1件")}に複数スキルが付くので、スキル別の件数の合計は全体を超える`],
    limits: LIMITS_BASE,
    facts: [...f.facts],
  };
};

const remoteGap: Builder = (s) => {
  const f = new Fmt();
  const rows = s.bySkill.filter((r) => r.remoteRates.n >= MIN_SPLIT && r.onsiteRates.n >= MIN_SPLIT && r.remoteRates.median !== null && r.onsiteRates.median !== null).slice(0, 20);
  if (rows.length < 5) return null;
  const notes = common(s, f);
  const ws = s.byWorkStyle.map((w) => `${w.label} ${f.n(w.count)}（中央値 ${f.man(w.rates.median)}）`).join("、");
  const diff = (r: (typeof rows)[number]) => r.remoteRates.median! - r.onsiteRates.median!;
  const signed = (v: number) => (v === 0 ? "差なし" : `${v > 0 ? "リモート可が" : "出社が"}${f.man(Math.abs(v))}高い`);
  return {
    id: "remote-gap",
    method: ["スキルごとにリモート可と出社に分ける", "中央値の差を見る"],
    title: `リモート可と出社で、単価の上限は違うのか。スキル別に${s.total}件を比べた`,
    subject: "同じスキルの案件を、リモート可（フルリモート・一部リモート）と出社に分けたときの単価の上限の中央値の差",
    keywords: ["フリーランス", "リモートワーク", "単価", "エンジニア", "SES"],
    tableHeading: "スキル別 リモート可と出社の単価の上限（中央値・月額）",
    table: { head: ["スキル", "リモート可", "出社", "差"], rows: rows.map((r) => [r.skill, `${f.man(r.remoteRates.median)}（${f.n(r.remoteRates.n)}）`, `${f.man(r.onsiteRates.median)}（${f.n(r.onsiteRates.n)}）`, signed(diff(r))]) },
    chart: { kind: "dumbbell", title: "リモート可と出社の単価の上限（中央値・月額）", subtitle: "赤=リモート可 / 黒=出社", legend: ["リモート可", "出社"], rows: rows.map((r) => ({ label: r.skill, a: r.remoteRates.median!, b: r.onsiteRates.median! })) },
    notes: [...notes, `働き方の内訳: ${ws}`, `リモート可・出社それぞれ単価の上限がわかる案件が${f.fixed(`${MIN_SPLIT}件`)}以上のスキルだけを載せる`],
    limits: [...LIMITS_BASE, "リモートの頻度（週何日出社か）。一部リモートは頻度を区別していない"],
    facts: [...f.facts],
  };
};

const remoteShare: Builder = (s) => {
  const f = new Fmt();
  const rows = [...s.bySkill].slice(0, 25).sort((a, b) => (b.remote + b.hybrid) / b.count - (a.remote + a.hybrid) / a.count || b.count - a.count);
  if (rows.length < 5) return null;
  const notes = common(s, f);
  return {
    id: "remote-share",
    method: ["スキルごとに働き方で分ける", "件数と割合を数える"],
    title: `リモートで探しやすいスキルはどれか。掲載中${s.total}件の働き方をスキル別に数えた`,
    subject: "スキルごとの、フルリモート・一部リモート・出社の件数と、リモート可の割合",
    keywords: ["フリーランス", "リモートワーク", "フルリモート", "エンジニア", "SES"],
    tableHeading: "スキル別 働き方の内訳（リモート可の割合の高い順）",
    table: { head: ["スキル", "件数", "フルリモート", "一部リモート", "出社", "リモート可の割合"], rows: rows.map((r) => [r.skill, f.n(r.count), f.n(r.remote), f.n(r.hybrid), f.n(r.onsite), f.pct(r.remote + r.hybrid, r.count)]) },
    chart: { kind: "stack", title: "スキル別 働き方の内訳", subtitle: "濃い赤=フルリモート / 薄い赤=一部リモート / 灰=出社", legend: ["フルリモート", "一部リモート", "出社"], rows: rows.slice(0, 15).map((r) => ({ label: r.skill, note: `${r.count}件`, parts: [r.remote, r.hybrid, r.onsite] })) },
    notes: [...notes, `全体ではフルリモート ${f.n(s.byWorkStyle.find((w) => w.key === "remote")?.count ?? 0)}・一部リモート ${f.n(s.byWorkStyle.find((w) => w.key === "hybrid")?.count ?? 0)}・出社 ${f.n(s.byWorkStyle.find((w) => w.key === "onsite")?.count ?? 0)}`],
    limits: [...LIMITS_BASE.slice(1), "一部リモートの出社頻度"],
    facts: [...f.facts],
  };
};

const station: Builder = (s) => {
  const f = new Fmt();
  const rows = s.byStation.slice(0, 20);
  if (rows.length < 5) return null;
  const notes = common(s, f);
  return {
    id: "station",
    method: ["勤務地の最寄り駅で分ける", "件数と中央値を出す"],
    title: `出社する案件はどの駅に多いか。勤務地の駅別に案件数と単価の上限を数えた（${s.total}件）`,
    subject: "勤務地に書かれた最寄り駅ごとの案件数と、単価の上限の中央値",
    keywords: ["フリーランス", "東京", "単価", "エンジニア", "SES"],
    tableHeading: "駅別の案件数と単価の上限（月額・件数の多い順）",
    table: { head: ["駅", "件数", "中央値", "真ん中の半分"], rows: rows.map((r) => [r.station, f.n(r.count), f.man(r.rates.median), f.range(r.rates)]) },
    chart: { kind: "bars", title: "勤務地の駅別 案件数", subtitle: "上位15駅", rows: rows.slice(0, 15).map((r) => ({ label: r.station, value: r.count, valueLabel: f.n(r.count) })) },
    notes: [...notes, "駅は勤務地の欄に書かれた最寄り駅。フルリモートの案件は駅が無いので数えていない", `駅ごとに${f.fixed("5件")}以上ある駅だけを載せる`],
    limits: [...LIMITS_BASE, "出社の頻度（一部リモートの案件も駅に数えている）"],
    facts: [...f.facts],
  };
};

const role: Builder = (s) => {
  const f = new Fmt();
  const rows = s.byRole.filter((r) => r.rates.n >= MIN_SPLIT);
  if (rows.length < 3) return null;
  const notes = common(s, f);
  return {
    id: "role",
    method: ["題名の役割名で分ける", "中央値と真ん中の半分を出す"],
    title: `PM・PMO・リーダーの案件は単価の上限が高いのか。題名の役割名で${s.total}件を分けた`,
    subject: "案件の題名に書かれた役割名（PM・PMO・PL/リーダー・アーキテクト・コンサルタント）ごとの単価の上限",
    keywords: ["フリーランス", "PM", "PMO", "単価", "SES"],
    tableHeading: "役割名別の単価の上限（月額）",
    table: { head: ["役割名", "件数", "中央値", "真ん中の半分", "最高"], rows: rows.map((r) => [r.label, f.n(r.count), f.man(r.rates.median), f.range(r.rates), f.man(r.rates.max)]) },
    chart: { kind: "range", title: "題名の役割名別 単価の上限（月額）", subtitle: "点=中央値 / 線=真ん中の半分", rows: rows.map((r) => ({ label: r.label, note: `${r.count}件`, median: r.rates.median!, lo: r.rates.p25!, hi: r.rates.p75! })) },
    notes: [...notes, "役割名は題名の語だけで分けた（PMO は PM より先に判定）。本文の条件は見ていない", `単価の上限がわかる案件が${f.fixed(`${MIN_SPLIT}件`)}以上の役割名だけを載せる`],
    limits: [...LIMITS_BASE, "実際の担当範囲（題名に PM とあっても開発中心の案件がありうる）"],
    facts: [...f.facts],
  };
};

const skillCount: Builder = (s) => {
  const f = new Fmt();
  const rows = s.bySkillCount.filter((r) => r.rates.n >= MIN_SPLIT);
  if (rows.length < 3) return null;
  const notes = common(s, f);
  return {
    id: "skill-count",
    method: ["付いたスキルの数で分ける", "中央値と真ん中の半分を出す"],
    title: `求められる技術が多い案件ほど単価の上限は高いのか。スキルの数で${s.total}件を分けた`,
    subject: "案件に付いているスキルの数（1〜5以上）ごとの単価の上限",
    keywords: ["フリーランス", "スキル", "単価", "エンジニア", "SES"],
    tableHeading: "スキルの数別の単価の上限（月額）",
    table: { head: ["スキルの数", "件数", "中央値", "真ん中の半分", "最高"], rows: rows.map((r) => [r.skills, f.n(r.count), f.man(r.rates.median), f.range(r.rates), f.man(r.rates.max)]) },
    chart: { kind: "range", title: "案件に付いたスキルの数別 単価の上限（月額）", subtitle: "点=中央値 / 線=真ん中の半分", rows: rows.map((r) => ({ label: `スキル${r.skills}個`, note: `${r.count}件`, median: r.rates.median!, lo: r.rates.p25!, hi: r.rates.p75! })) },
    notes: [...notes, "スキルの数は、掲載元が案件に付けたスキルの語の数（必須と歓迎の区別は無い）"],
    limits: [...LIMITS_BASE, "必須スキルと歓迎スキルの違い（データに区別が無い）"],
    facts: [...f.facts],
  };
};

const pairs: Builder = (s) => {
  const f = new Fmt();
  const rows = s.skillPairs.filter((r) => r.rates.median !== null).slice(0, 20);
  if (rows.length < 5) return null;
  const notes = common(s, f);
  return {
    id: "skill-pairs",
    method: ["一緒に付くスキル2つの組で分ける", "件数と中央値を出す"],
    title: `一緒に求められることが多いスキルの組み合わせと、その単価の上限（${s.total}件）`,
    subject: "同じ案件に一緒に付いていることが多いスキル2つの組み合わせと、その案件の単価の上限",
    keywords: ["フリーランス", "スキル", "単価", "エンジニア", "SES"],
    tableHeading: "スキルの組み合わせ別の件数と単価の上限（月額・件数の多い順）",
    table: { head: ["組み合わせ", "件数", "中央値", "真ん中の半分"], rows: rows.map((r) => [r.pair, f.n(r.count), f.man(r.rates.median), f.range(r.rates)]) },
    chart: { kind: "range", title: "よく一緒に求められる組み合わせ 単価の上限（月額）", subtitle: "件数の多い15組 / 点=中央値 / 線=真ん中の半分", rows: rows.slice(0, 15).map((r) => ({ label: r.pair, note: `${r.count}件`, median: r.rates.median!, lo: r.rates.p25!, hi: r.rates.p75! })) },
    notes: [...notes, `組み合わせは同じ案件に付いていたスキル2つ。${f.fixed("5件")}以上ある組み合わせだけを載せる`],
    limits: LIMITS_BASE,
    facts: [...f.facts],
  };
};

const rateBands: Builder = (s) => {
  const f = new Fmt();
  const o = s.overall;
  if (o.n < 50) return null;
  const notes = common(s, f);
  const th: [string, string][] = [["800000", "月80万円以上"], ["900000", "月90万円以上"], ["1000000", "月100万円以上"], ["1200000", "月120万円以上"], ["1500000", "月150万円以上"]];
  const rows = th.filter(([k]) => o.atLeast[k] !== undefined).map(([k, label]) => [label, f.n(o.atLeast[k]), f.pct(o.atLeast[k], o.n)]);
  return {
    id: "rate-bands",
    method: ["単価の上限の帯で分ける", "帯ごとの件数を数える"],
    title: `月100万円以上の案件は何件あるか。単価の上限の分布を${o.n}件で見た`,
    subject: "単価の上限の分布と、月80万円・100万円・120万円など以上の案件の件数",
    keywords: ["フリーランス", "単価", "年収", "エンジニア", "SES"],
    tableHeading: "単価の上限が一定額以上の案件",
    table: { head: ["単価の上限", "件数", `全体（${o.n}件）に占める割合`], rows },
    chart: { kind: "bars", title: "単価の上限の分布（月額）", subtitle: `${o.n}件`, rows: o.buckets.map((b) => ({ label: bandLabel(b.label), value: b.count, valueLabel: f.n(b.count) })) },
    notes: [...notes, `全体の中央値は ${f.man(o.median)}、真ん中の半分は ${f.range(o)}、最高は ${f.man(o.max)}`],
    limits: LIMITS_BASE,
    facts: [...f.facts, ...rows.map((r) => r[0].replace("月", "").replace("以上", "")), ...o.buckets.map((b) => bandLabel(b.label))],
  };
};

export const CUTS: { id: string; build: Builder }[] = [
  { id: "skill-rates", build: skillRates },
  { id: "remote-gap", build: remoteGap },
  { id: "station", build: station },
  { id: "role", build: role },
  { id: "remote-share", build: remoteShare },
  { id: "skill-pairs", build: pairs },
  { id: "rate-bands", build: rateBands },
  { id: "skill-count", build: skillCount },
];

/** 一番長く使っていない切り口から順に試す（使ったことが無いものが最優先） */
export function pickCut(s: MarketStats, lastUsed: Record<string, string>, only?: string): CutResult | null {
  const order = only ? CUTS.filter((c) => c.id === only) : [...CUTS].sort((a, b) => (lastUsed[a.id] ?? "").localeCompare(lastUsed[b.id] ?? ""));
  for (const c of order) {
    const r = c.build(s);
    if (r) return r;
  }
  return null;
}
