// 2026-10-28: 集計記事の図。数字から SVG をコードで描き、Playwright で PNG にする（LLM に図を描かせると数字が変わりうるため）。
// 見た目は雑誌の図表に寄せる（白地・黒文字・罫線・アクセントは赤1色）。参考: qiita.com/kikuziro/items/b6a0743b070d7320c36d
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type ChartSpec =
  | { kind: "range"; title: string; subtitle: string; rows: { label: string; note: string; median: number; lo: number; hi: number }[] }
  | { kind: "dumbbell"; title: string; subtitle: string; legend: [string, string]; rows: { label: string; a: number; b: number }[] }
  | { kind: "stack"; title: string; subtitle: string; legend: [string, string, string]; rows: { label: string; note: string; parts: [number, number, number] }[] }
  | { kind: "bars"; title: string; subtitle: string; rows: { label: string; value: number; valueLabel: string }[] }
  /** 要点: 大きな数字を3つまで横に並べる（新聞の図表の「見出しの数字」） */
  | { kind: "kpi"; title: string; subtitle: string; items: { label: string; value: string; note: string }[] }
  /** 図解: 集計の流れを左から右へ */
  | { kind: "flow"; title: string; subtitle: string; steps: { value: string; label: string }[] }
  /** 表: note は表の書式を表示しないので画像にする。accent を含む行は最後の列を赤にする（図の赤と同じ意味） */
  | { kind: "table"; title: string; subtitle: string; head: string[]; rows: string[][]; accent?: string };

// 2026-10-30: note はスマホで幅358pxに縮むので、1200px の図は20pxの字が6pxになり読めなかった（note-score-20261030 の採点で D1 2〜3点）。
// note には幅760・字1.3倍の縦長の配置（mobile）で描く。Qiita/Zenn は従来の横長
type Layout = { W: number; ROW: number; TOP: number; LEFT: number; RIGHT: number; S: number; mobile: boolean; stacked?: boolean };
const DESK: Layout = { W: 1200, ROW: 44, TOP: 150, LEFT: 300, RIGHT: 120, S: 1, mobile: false };
let L: Layout = DESK;
const INK = "#111111";
const SUB = "#666666";
const RULE = "#d9d9d9";
const RED = "#c8102e";
const PALE = "#f2a3ae";
const GRAY = "#bdbdbd";
const FONT = `"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const man = (v: number) => `${+(v / 10000).toFixed(1)}万円`;

function text(x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: string; weight?: number } = {}) {
  return `<text x="${x}" y="${y}" font-size="${Math.round((o.size ?? 20) * L.S)}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? "start"}" font-weight="${o.weight ?? 400}">${esc(s)}</text>`;
}

/** 金額の軸: 10万円刻みに丸める */
function moneyAxis(lo: number, hi: number) {
  const step = 100000;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step || step;
  const x = (v: number) => L.LEFT + ((v - min) / (max - min || 1)) * (L.W - L.LEFT - L.RIGHT);
  const ticks: number[] = [];
  const every = (max - min) / step > 12 ? step * 2 : step;
  for (let v = min; v <= max; v += every) ticks.push(v);
  return { x, ticks };
}

function grid(ticks: number[], x: (v: number) => number, bottom: number, label: (v: number) => string) {
  // 目盛りの字が重なるほど狭いときは、字を1つおきにする（スマホ用の図で 50万60万… が重なった）
  const gap = ticks.length > 1 ? x(ticks[1]) - x(ticks[0]) : Infinity;
  const every = gap < Math.max(...ticks.map((t) => em(label(t)))) * 16 * L.S + 12 ? 2 : 1;
  return ticks.map((t, i) => `<line x1="${x(t)}" y1="${L.TOP - 10}" x2="${x(t)}" y2="${bottom}" stroke="${RULE}" stroke-width="1"/>` + (i % every ? "" : text(x(t), bottom + 28, label(t), { size: 16, fill: SUB, anchor: "middle" }))).join("");
}

/** 12字ごとに折り返す（図解の箱の中の説明） */
const wrap = (s: string, n = 12) => (s.length <= n ? [s] : [s.slice(0, n), s.slice(n, 2 * n)]);

/** 全角1・半角0.55で数えた文字の幅 */
const em = (t: string) => [...t].reduce((a, ch) => a + (/[ -~]/.test(ch) ? 0.55 : 1), 0);
/** 幅 w（字の幅の単位）に収まるよう行に分ける */
function lines(s: string, w: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of s) {
    if (em(cur + ch) > w) { out.push(cur); cur = ""; }
    cur += ch;
  }
  return cur ? [...out, cur] : out;
}

function mobileLayout(spec: ChartSpec): Layout {
  const W = 760;
  const S = 1.4;
  const labels = "rows" in spec && spec.kind !== "table" ? (spec.rows as { label: string }[]).map((r) => r.label) : [];
  const LEFT = Math.min(400, Math.max(180, Math.max(0, ...labels.map(em)) * 20 * S + 44));
  if (spec.kind === "table") {
    // 1行に収まる表はそのまま。収まらない表（列が多い・欄が長い）は、1行を2段にする（1段目=名前と最後の列、2段目=残りの列）
    const need = spec.head.map((h, c) => Math.max(em(h), ...spec.rows.map((r) => em(r[c] ?? ""))) + 1.5).reduce((a, b) => a + b, 0);
    if (need * 20 * S <= W - 48) return { W, ROW: Math.round(44 * S), TOP: 0, LEFT, RIGHT: 140, S, mobile: true };
    return { W, ROW: 96, TOP: 0, LEFT, RIGHT: 140, S, mobile: true, stacked: true };
  }
  return { W, ROW: 60, TOP: 0, LEFT, RIGHT: 140, S, mobile: true };
}

export function renderSvg(spec: ChartSpec, source: string, mobile = false): string {
  L = mobile ? mobileLayout(spec) : DESK;
  try {
    return draw(spec, source);
  } finally {
    L = DESK;
  }
}

function draw(spec: ChartSpec, source: string): string {
  // 題と副題: スマホ用は折り返す。本体はその下から
  const titleLines = L.mobile ? lines(spec.title, (L.W - 48) / (34 * 1.3)) : [spec.title];
  const subLines = L.mobile ? lines(spec.subtitle, (L.W - 48) / (18 * L.S)) : [spec.subtitle];
  const titleSize = L.mobile ? 34 * 1.3 / L.S : 34;
  const head: string[] = [];
  let hy = 70;
  titleLines.forEach((t, i) => { head.push(text(24, hy + i * (L.mobile ? 54 : 40), t, { size: titleSize, weight: 700 })); });
  hy += (titleLines.length - 1) * (L.mobile ? 54 : 40) + (L.mobile ? 44 : 38);
  subLines.forEach((t, i) => { head.push(text(24, hy + i * 30, t, { size: 18, fill: SUB })); });
  if (L.mobile) L = { ...L, TOP: hy + (subLines.length - 1) * 30 + 52 };
  const n = spec.kind === "kpi" || spec.kind === "flow" ? 0 : spec.kind === "table" ? spec.rows.length + (L.stacked ? 0 : 1) : spec.rows.length;
  const tall = L.mobile && (spec.kind === "kpi" || spec.kind === "flow");
  const bottom = tall ? L.TOP + (spec.kind === "kpi" ? spec.items.length * 190 : spec.steps.length * 150) - 30
    : spec.kind === "kpi" ? L.TOP + 230 : spec.kind === "flow" ? L.TOP + 210 : L.TOP + n * L.ROW;
  const H = bottom + 110;
  const body: string[] = [];
  const rowY = (i: number) => L.TOP + i * L.ROW + L.ROW / 2;

  if (spec.kind === "table" && L.stacked) {
    const last = spec.head.length - 1;
    const mids = spec.head.map((_, c) => c).filter((c) => c > 0 && c < last);
    spec.rows.forEach((r, i) => {
      const y0 = L.TOP + i * L.ROW;
      const hot = !!spec.accent && r.some((v) => v.includes(spec.accent!));
      body.push(text(24, y0 + 38, r[0], { size: 20, weight: 700 }));
      // 右端の値には列の名前を小さく添える（2段にすると列の見出し行が無くなるため）
      body.push(`<text x="${L.W - 24}" y="${y0 + 38}" text-anchor="end" font-size="${Math.round(20 * L.S)}" font-weight="700" fill="${hot ? RED : INK}"><tspan font-size="${Math.round(15 * L.S)}" font-weight="400" fill="${SUB}">${esc(spec.head[last])} </tspan>${esc(r[last])}</text>`);
      const sub = mids.map((c) => `${spec.head[c]} ${r[c]}`).join("　");
      body.push(text(24, y0 + 78, sub, { size: Math.min(18, (L.W - 48) / (em(sub) * L.S)), fill: SUB }));
      body.push(`<line x1="24" y1="${y0 + L.ROW - 4}" x2="${L.W - 24}" y2="${y0 + L.ROW - 4}" stroke="${RULE}" stroke-width="1"/>`);
    });
  } else if (spec.kind === "table") {
    // 列幅は文字数で配分（全角1・半角0.55）
    const need = spec.head.map((h, c) => Math.max(em(h), ...spec.rows.map((r) => em(r[c] ?? ""))) + 1.5);
    const sum = need.reduce((a, b) => a + b, 0);
    const xs = need.reduce<number[]>((acc, v, i) => [...acc, i ? acc[i - 1] + (need[i - 1] / sum) * (L.W - 48) : 24], []);
    const last = spec.head.length - 1;
    spec.head.forEach((h, c) => body.push(text(xs[c] + 8, rowY(0) + 7, h, { size: 18, fill: SUB, weight: 700 })));
    body.push(`<line x1="24" y1="${L.TOP + L.ROW}" x2="${L.W - 24}" y2="${L.TOP + L.ROW}" stroke="${INK}" stroke-width="2"/>`);
    spec.rows.forEach((r, i) => {
      const y = rowY(i + 1);
      const hot = !!spec.accent && r.some((v) => v.includes(spec.accent!));
      r.forEach((v, c) => body.push(text(xs[c] + 8, y + 7, v, { size: 20, weight: c === 0 || c === last ? 700 : 400, fill: c === last && hot ? RED : INK })));
      body.push(`<line x1="24" y1="${L.TOP + (i + 2) * L.ROW}" x2="${L.W - 24}" y2="${L.TOP + (i + 2) * L.ROW}" stroke="${RULE}" stroke-width="1"/>`);
    });
  } else if (spec.kind === "kpi" && L.mobile) {
    spec.items.forEach((it, i) => {
      const y0 = L.TOP + i * 190;
      if (i) body.push(`<line x1="24" y1="${y0 - 24}" x2="${L.W - 24}" y2="${y0 - 24}" stroke="${RULE}" stroke-width="1"/>`);
      body.push(text(24, y0 + 10, it.label, { size: 20, fill: SUB, weight: 600 }));
      body.push(text(24, y0 + 80, it.value, { size: 52, weight: 800, fill: i === 0 ? RED : INK }));
      body.push(text(24, y0 + 124, it.note.replace(": ", " "), { size: 19 }));
    });
  } else if (spec.kind === "flow" && L.mobile) {
    spec.steps.forEach((st, i) => {
      const y0 = L.TOP + i * 150;
      const last = i === spec.steps.length - 1;
      body.push(`<rect x="24" y="${y0}" width="${L.W - 48}" height="104" fill="#ffffff" stroke="${last ? RED : INK}" stroke-width="${last ? 3 : 1.5}"/>`);
      body.push(text(48, y0 + 40, `${i + 1}  ${st.label}`, { size: 18, fill: SUB, weight: 700 }));
      body.push(text(48, y0 + 86, st.value, { size: 34, weight: 800, fill: last ? RED : INK }));
      if (!last) body.push(`<polygon points="${L.W / 2 - 12},${y0 + 116} ${L.W / 2 + 12},${y0 + 116} ${L.W / 2},${y0 + 136}" fill="${INK}"/>`);
    });
  } else if (spec.kind === "kpi") {
    const colW = (L.W - 48) / spec.items.length;
    spec.items.forEach((it, i) => {
      const x0 = 24 + i * colW;
      if (i) body.push(`<line x1="${x0}" y1="${L.TOP}" x2="${x0}" y2="${bottom - 10}" stroke="${RULE}" stroke-width="1"/>`);
      const x = x0 + (i ? 28 : 0);
      body.push(text(x, L.TOP + 30, it.label, { size: 20, fill: SUB, weight: 600 }));
      body.push(text(x, L.TOP + 120, it.value, { size: it.value.length > 6 ? 56 : 68, weight: 800, fill: i === 0 ? RED : INK }));
      (it.note.includes(": ") ? it.note.split(/: |・/) : wrap(it.note, 18)).forEach((l, k) => body.push(text(x, L.TOP + 170 + k * 28, l, { size: 19, fill: INK })));
    });
  } else if (spec.kind === "flow") {
    const k = spec.steps.length;
    const gap = 56;
    const bw = (L.W - 48 - gap * (k - 1)) / k;
    const y0 = L.TOP + 10;
    const bh = 180;
    spec.steps.forEach((st, i) => {
      const x0 = 24 + i * (bw + gap);
      const last = i === k - 1;
      body.push(`<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" fill="#ffffff" stroke="${last ? RED : INK}" stroke-width="${last ? 3 : 1.5}"/>`);
      body.push(text(x0 + 20, y0 + 34, `${i + 1}`, { size: 18, fill: SUB, weight: 700 }));
      body.push(text(x0 + 20, y0 + 92, st.value, { size: st.value.length > 6 ? 30 : 44, weight: 800, fill: last ? RED : INK }));
      wrap(st.label).forEach((l, j) => body.push(text(x0 + 20, y0 + 132 + j * 26, l, { size: 18 })));
      if (!last) {
        const ax = x0 + bw + 10;
        const ay = y0 + bh / 2;
        body.push(`<line x1="${ax}" y1="${ay}" x2="${ax + gap - 24}" y2="${ay}" stroke="${INK}" stroke-width="2"/><polygon points="${ax + gap - 24},${ay - 7} ${ax + gap - 12},${ay} ${ax + gap - 24},${ay + 7}" fill="${INK}"/>`);
      }
    });
  } else if (spec.kind === "range") {
    const { x, ticks } = moneyAxis(Math.min(...spec.rows.map((r) => r.lo)), Math.max(...spec.rows.map((r) => r.hi)));
    body.push(grid(ticks, x, bottom, (v) => `${v / 10000}万`));
    spec.rows.forEach((r, i) => {
      const y = rowY(i);
      body.push(text(L.LEFT - 20, y + 7, r.label, { anchor: "end", weight: 600 }));
      body.push(`<line x1="${x(r.lo)}" y1="${y}" x2="${x(r.hi)}" y2="${y}" stroke="${GRAY}" stroke-width="10" stroke-linecap="butt"/>`);
      body.push(`<circle cx="${x(r.median)}" cy="${y}" r="9" fill="${RED}"/>`);
      body.push(text(L.W - L.RIGHT + 16, y + 7, man(r.median), { size: 18, weight: 600 }));
      if (!L.mobile) body.push(text(24, y + 7, r.note, { size: 16, fill: SUB }));
    });
  } else if (spec.kind === "dumbbell") {
    const all = spec.rows.flatMap((r) => [r.a, r.b]);
    const { x, ticks } = moneyAxis(Math.min(...all), Math.max(...all));
    body.push(grid(ticks, x, bottom, (v) => `${v / 10000}万`));
    spec.rows.forEach((r, i) => {
      const y = rowY(i);
      body.push(text(L.LEFT - 20, y + 7, r.label, { anchor: "end", weight: 600 }));
      body.push(`<line x1="${x(r.a)}" y1="${y}" x2="${x(r.b)}" y2="${y}" stroke="${GRAY}" stroke-width="4"/>`);
      // 同じ値のときは赤を小さくして、下の黒が見えるようにする
      body.push(`<circle cx="${x(r.b)}" cy="${y}" r="9" fill="${INK}"/><circle cx="${x(r.a)}" cy="${y}" r="${r.a === r.b ? 5 : 9}" fill="${RED}"/>`);
    });
  } else if (spec.kind === "stack") {
    const span = L.W - L.LEFT - L.RIGHT;
    const fills = [RED, PALE, GRAY];
    spec.rows.forEach((r, i) => {
      const y = rowY(i);
      const total = r.parts.reduce((a, b) => a + b, 0) || 1;
      body.push(text(L.LEFT - 20, y + 7, r.label, { anchor: "end", weight: 600 }) + (L.mobile ? "" : text(24, y + 7, r.note, { size: 16, fill: SUB })));
      let cx = L.LEFT;
      r.parts.forEach((p, k) => {
        const w = (p / total) * span;
        body.push(`<rect x="${cx}" y="${y - 13}" width="${w}" height="26" fill="${fills[k]}"/>`);
        cx += w;
      });
      body.push(text(L.W - L.RIGHT + 16, y + 7, `${Math.round(((r.parts[0] + r.parts[1]) / total) * 100)}%`, { size: 18, weight: 600 }));
    });
    body.push(grid([0, 25, 50, 75, 100], (v) => L.LEFT + (v / 100) * span, bottom, (v) => `${v}%`));
  } else {
    const max = Math.max(...spec.rows.map((r) => r.value), 1);
    const span = L.W - L.LEFT - L.RIGHT;
    spec.rows.forEach((r, i) => {
      const y = rowY(i);
      body.push(text(L.LEFT - 20, y + 7, r.label, { anchor: "end", weight: 600 }));
      body.push(`<rect x="${L.LEFT}" y="${y - 13}" width="${(r.value / max) * span}" height="26" fill="${i === spec.rows.reduce((m, q, k, a) => (q.value > a[m].value ? k : m), 0) ? RED : GRAY}"/>`);
      body.push(text(L.LEFT + (r.value / max) * span + 10, y + 7, r.valueLabel, { size: 18, weight: 600 }));
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${H}" viewBox="0 0 ${L.W} ${H}" font-family='${FONT}'>
<rect width="${L.W}" height="${H}" fill="#ffffff"/>
<line x1="24" y1="20" x2="${L.W - 24}" y2="20" stroke="${INK}" stroke-width="4"/>
${head.join("\n")}
${body.join("\n")}
<line x1="24" y1="${H - 50}" x2="${L.W - 24}" y2="${H - 50}" stroke="${RULE}" stroke-width="1"/>
${text(24, H - 20, source, { size: 16, fill: SUB })}
</svg>`;
}

/** note の見出し画像は 1280x670 で上下が切れるので、行を減らした図を横長の枠に収める */
export async function renderEyecatch(spec: ChartSpec, source: string, pngPath: string): Promise<string> {
  const MAX_ROWS = 8;
  const slim: ChartSpec = "rows" in spec && spec.rows.length > MAX_ROWS
    ? ({ ...spec, subtitle: `${spec.subtitle}（上位${MAX_ROWS}行・全体は本文）`, rows: spec.rows.slice(0, MAX_ROWS) } as ChartSpec)
    : spec;
  const svg = renderSvg(slim, source);
  mkdirSync(dirname(pngPath), { recursive: true });
  const browser = await chromium.launch();
  try {
    // note は 1280x670 として受け取り、それより大きい画像は左上だけを切り取る（2倍で出したら4分の1しか出なかった 2026-10-28）
    const page = await browser.newPage({ viewport: { width: 1280, height: 670 }, deviceScaleFactor: 1 });
    const fit = svg.replace(/^<svg ([^>]*?)width="\d+" height="\d+"/, '<svg $1width="100%" height="100%" preserveAspectRatio="xMidYMid meet"');
    await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:670px;background:#fff">${fit}</body></html>`);
    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1280, height: 670 } });
  } finally {
    await browser.close();
  }
  return pngPath;
}

/** 見出し画像（1280x670）。2026-10-30 採点で「一覧で見出し画像の字が小さい」（T1）と出たので、図の縮小でなく、問い＋いちばんの数字を大きく載せる */
export function coverSvg(o: { kicker: string; question: string; item: { label: string; value: string; note: string }; foot: string }): string {
  const W0 = 1280, H0 = 670;
  // 「、」で2行に分けられるならそこで切る（「違う／のか」のような泣き別れを避ける）
  const cut = o.question.indexOf("、");
  const q = cut > 0 && em(o.question.slice(0, cut + 1)) <= 18 && em(o.question.slice(cut + 1)) <= 18
    ? [o.question.slice(0, cut + 1), o.question.slice(cut + 1)] : lines(o.question, 18).slice(0, 2);
  const t = (x: number, y: number, s: string, size: number, fill = INK, weight = 400) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}">${esc(s)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W0}" height="${H0}" viewBox="0 0 ${W0} ${H0}" font-family='${FONT}'>
<rect width="${W0}" height="${H0}" fill="#ffffff"/>
<rect x="0" y="0" width="${W0}" height="14" fill="${RED}"/>
${t(56, 84, o.kicker, 28, SUB, 700)}
${q.map((l, i) => t(56, 170 + i * 76, l, 64, INK, 800)).join("\n")}
<line x1="56" y1="${q.length > 1 ? 300 : 230}" x2="${W0 - 56}" y2="${q.length > 1 ? 300 : 230}" stroke="${RULE}" stroke-width="2"/>
${t(56, q.length > 1 ? 360 : 300, o.item.label, 32, SUB, 700)}
${t(56, q.length > 1 ? 500 : 450, o.item.value, 132, RED, 800)}
${t(56, q.length > 1 ? 560 : 520, o.item.note.replace(": ", " "), 32, INK, 600)}
${t(56, H0 - 30, o.foot, 20, SUB)}
</svg>`;
}

export async function renderCover(o: Parameters<typeof coverSvg>[0], pngPath: string): Promise<string> {
  const svg = coverSvg(o);
  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(pngPath.replace(/\.png$/, ".svg"), svg, "utf-8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 670 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1280, height: 670 } });
  } finally {
    await browser.close();
  }
  return pngPath;
}

/** SVG と PNG を書いて PNG のパスを返す */
export async function renderPng(spec: ChartSpec, source: string, pngPath: string, mobile = false): Promise<string> {
  const svg = renderSvg(spec, source, mobile);
  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(pngPath.replace(/\.png$/, ".svg"), svg, "utf-8");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await page.locator("svg").screenshot({ path: pngPath });
  } finally {
    await browser.close();
  }
  return pngPath;
}
