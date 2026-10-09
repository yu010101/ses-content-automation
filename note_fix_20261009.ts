// note の公開済み記事の末尾(根拠のない誘導)を事実の1段落に差し替える。2026-10-09
// 使い方: tsx note_fix.ts <key> [<key> ...]   控え: data/note_backup_20261009/<key>.json
import { NoteClient } from "/Users/radineer01/ses-content-automation/src/publishers/note-client";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

const BK = "/Users/radineer01/ses-content-automation/data/note_backup_20261009";
mkdirSync(BK, { recursive: true });
const OLD = /<h2[^>]*>💼[^<]*<\/h2>[\s\S]*?<p[^>]*>▶ <a href="https:\/\/radineer\.asia\/freelance\/register[^"]*"[^>]*>[\s\S]*?<\/p>/;
const CROSS = /<p[^>]*>(?:技術的な詳細はQiitaでも解説しています|Zennでも記事を公開中)[\s\S]*?<\/p>/g;

async function getNote(key: string) {
  const r = await fetch(`https://note.com/api/v3/notes/${key}`);
  return ((await r.json()) as any).data;
}

const client = new NoteClient();
await client.login();
for (const key of process.argv.slice(2)) {
  const n = await getNote(key);
  if (!existsSync(`${BK}/${key}.json`)) writeFileSync(`${BK}/${key}.json`, JSON.stringify(n));
  const body: string = n.body;
  const m = body.match(OLD);
  if (!m) { console.log(key, "SKIP no old CTA"); continue; }
  const url = `https://radineer.asia/freelance/register?utm_source=note&amp;utm_medium=article&amp;utm_campaign=${key}`;
  const repl = `<p>この記事は、フリーランス向け案件サイト「FreelanceDB」（合同会社Radineer）の運営者が書きました。<br>コンサル・PMO領域の非公開案件を扱っており、希望条件を登録いただいた方に個別にご連絡しています。</p><p><a href="${url}" target="_blank" rel="nofollow noopener">希望条件を登録する</a></p>`;
  const nb = body.replace(OLD, repl).replace(CROSS, "");
  const tags = (n.hashtag_notes || []).map((h: any) => h.hashtag?.name).filter(Boolean);
  await (client as any).saveDraftContent(n.id, n.name, nb, tags);
  const out = await client.publishViaEditor(key);
  const after = await getNote(key);
  console.log(key, "published:", out, "| old left:", /専任コーディネーター|高単価案件を多数/.test(after.body), "| new:", after.body.includes("個別にご連絡しています"), "| len", body.length, "->", after.body.length, "| status", after.status);
}
await client.close();
