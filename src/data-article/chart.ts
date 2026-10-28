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

const W = 1200;
const ROW = 44;
const TOP = 150;
const LEFT = 300;
const RIGHT = 120;
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
  return `<text x="${x}" y="${y}" font-size="${o.size ?? 20}" fill="${o.fill ?? INK}" text-anchor="${o.anchor ?? "start"}" font-weight="${o.weight ?? 400}">${esc(s)}</text>`;
}

/** 金額の軸: 10万円刻みに丸める */
function moneyAxis(lo: number, hi: number) {
  const step = 100000;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step || step;
  const x = (v: number) => LEFT + ((v - min) / (max - min || 1)) * (W - LEFT - RIGHT);
  const ticks: number[] = [];
  const every = (max - min) / step > 12 ? step * 2 : step;
  for (let v = min; v <= max; v += every) ticks.push(v);
  return { x, ticks };
}

function grid(ticks: number[], x: (v: number) => number, bottom: number, label: (v: number) => string) {
  return ticks.map((t) => `<line x1="${x(t)}" y1="${TOP - 10}" x2="${x(t)}" y2="${bottom}" stroke="${RULE}" stroke-width="1"/>` + text(x(t), bottom + 28, label(t), { size: 16, fill: SUB, anchor: "middle" })).join("");
}

/** 12字ごとに折り返す（図解の箱の中の説明） */
const wrap = (s: string, n = 12) => (s.length <= n ? [s] : [s.slice(0, n), s.slice(n, 2 * n)]);

export function renderSvg(spec: ChartSpec, source: string): string {
  const n = spec.kind === "kpi" || spec.kind === "flow" ? 0 : spec.kind === "table" ? spec.rows.length + 1 : spec.rows.length;
  const bottom = spec.kind === "kpi" ? TOP + 230 : spec.kind === "flow" ? TOP + 210 : TOP + n * ROW;
  const H = bottom + 110;
  const body: string[] = [];
  const rowY = (i: number) => TOP + i * ROW + ROW / 2;

  if (spec.kind === "table") {
    // 列幅は文字数で配分（全角1・半角0.55）
    const w = (t: string) => [...t].reduce((a, ch) => a + (/[ -~]/.test(ch) ? 0.55 : 1), 0);
    const need = spec.head.map((h, c) => Math.max(w(h), ...spec.rows.map((r) => w(r[c] ?? ""))) + 1.5);
    const sum = need.reduce((a, b) => a + b, 0);
    const xs = need.reduce<number[]>((acc, v, i) => [...acc, i ? acc[i - 1] + (need[i - 1] / sum) * (W - 48) : 24], []);
    const last = spec.head.length - 1;
    spec.head.forEach((h, c) => body.push(text(xs[c] + 8, rowY(0) + 7, h, { size: 18, fill: SUB, weight: 700 })));
    body.push(`<line x1="24" y1="${TOP + ROW}" x2="${W - 24}" y2="${TOP + ROW}" stroke="${INK}" stroke-width="2"/>`);
    spec.rows.forEach((r, i) => {
      const y = rowY(i + 1);
      const hot = !!spec.accent && r.some((v) => v.includes(spec.accent!));
      r.forEach((v, c) => body.push(text(xs[c] + 8, y + 7, v, { size: 20, weight: c === 0 || c === last ? 700 : 400, fill: c === last && hot ? RED : INK })));
      body.push(`<line x1="24" y1="${TOP + (i + 2) * ROW}" x2="${W - 24}" y2="${TOP + (i + 2) * ROW}" stroke="${RULE}" stroke-width="1"/>`);
    });
  } else if (spec.kind === "kpi") {
    const colW = (W - 48) / spec.items.length;
    spec.items.forEach((it, i) => {
      const x0 = 24 + i * colW;
      if (i) body.push(`<line x1="${x0}" y1="${TOP}" x2="${x0}" y2="${bottom - 10}" stroke="${RULE}" stroke-width="1"/>`);
      const x = x0 + (i ? 28 : 0);
      body.push(text(x, TOP + 30, it.label, { size: 20, fill: SUB, weight: 600 }));
      body.push(text(x, TOP + 120, it.value, { size: it.value.length > 6 ? 56 : 68, weight: 800, fill: i === 0 ? RED : INK }));
      (it.note.includes(": ") ? it.note.split(/: |・/) : wrap(it.note, 18)).forEach((l, k) => body.push(text(x, TOP + 170 + k * 28, l, { size: 19, fill: INK })));
    });
  } else if (spec.kind === "flow") {
    const k = spec.steps.length;
    const gap = 56;
    const bw = (W - 48 - gap * (k - 1)) / k;
    const y0 = TOP + 10;
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
      body.push(text(LEFT - 20, y + 7, r.label, { anchor: "end", weight: 600 }));
      body.push(`<line x1="${x(r.lo)}" y1="${y}" x2="${x(r.hi)}" y2="${y}" stroke="${GRAY}" stroke-width="10" stroke-linecap="butt"/>`);
      body.push(`<circle cx="${x(r.median)}" cy="${y}" r="9" fill="${RED}"/>`);
      body.push(text(W - RIGHT + 16, y + 7, man(r.median), { size: 18, weight: 600 }));
      body.push(text(24, y + 7, r.note, { size: 16, fill: SUB }));
    });
  } else if (spec.kind === "dumbbell") {
    const all = spec.rows.flatMap((r) => [r.a, r.b]);
    const { x, ticks } = moneyAxis(Math.min(...all), Math.max(...all));
    body.push(grid(ticks, x, bottom, (v) => `${v / 10000}万`));
    spec.rows.forEach((r, i) => {
      const y = rowY(i);
      body.push(text(LEFT - 20, y + 7, r.label, { anchor: "end", weight: 600 }));
      body.push(`<line x1="${x(r.a)}" y1="${y}" x2="${x(r.b)}" y2="${y}" stroke="${GRAY}" stroke-width="4"/>`);
      // 同じ値のときは赤を小さくして、下の黒が見えるようにする
      body.push(`<circle cx="${x(r.b)}" cy="${y}" r="9" fill="${INK}"/><circle cx="${x(r.a)}" cy="${y}" r="${r.a === r.b ? 5 : 9}" fill="${RED}"/>`);
    });
  } else if (spec.kind === "stack") {
    const span = W - LEFT - RIGHT;
    const fills = [RED, PALE, GRAY];
    spec.rows.forEach((r, i) => {
      const y = rowY(i);
      const total = r.parts.reduce((a, b) => a + b, 0) || 1;
      body.push(text(LEFT - 20, y + 7, r.label, { anchor: "end", weight: 600 }) + text(24, y + 7, r.note, { size: 16, fill: SUB }));
      let cx = LEFT;
      r.parts.forEach((p, k) => {
        const w = (p / total) * span;
        body.push(`<rect x="${cx}" y="${y - 13}" width="${w}" height="26" fill="${fills[k]}"/>`);
        cx += w;
      });
      body.push(text(W - RIGHT + 16, y + 7, `${Math.round(((r.parts[0] + r.parts[1]) / total) * 100)}%`, { size: 18, weight: 600 }));
    });
    body.push(grid([0, 25, 50, 75, 100], (v) => LEFT + (v / 100) * span, bottom, (v) => `${v}%`));
  } else {
    const max = Math.max(...spec.rows.map((r) => r.value), 1);
    const span = W - LEFT - RIGHT;
    spec.rows.forEach((r, i) => {
      const y = rowY(i);
      body.push(text(LEFT - 20, y + 7, r.label, { anchor: "end", weight: 600 }));
      body.push(`<rect x="${LEFT}" y="${y - 13}" width="${(r.value / max) * span}" height="26" fill="${i === spec.rows.reduce((m, q, k, a) => (q.value > a[m].value ? k : m), 0) ? RED : GRAY}"/>`);
      body.push(text(LEFT + (r.value / max) * span + 10, y + 7, r.valueLabel, { size: 18, weight: 600 }));
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${FONT}'>
<rect width="${W}" height="${H}" fill="#ffffff"/>
<line x1="24" y1="20" x2="${W - 24}" y2="20" stroke="${INK}" stroke-width="4"/>
${text(24, 70, spec.title, { size: 34, weight: 700 })}
${text(24, 108, spec.subtitle, { size: 18, fill: SUB })}
${body.join("\n")}
<line x1="24" y1="${H - 50}" x2="${W - 24}" y2="${H - 50}" stroke="${RULE}" stroke-width="1"/>
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

/** SVG と PNG を書いて PNG のパスを返す */
export async function renderPng(spec: ChartSpec, source: string, pngPath: string): Promise<string> {
  const svg = renderSvg(spec, source);
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
