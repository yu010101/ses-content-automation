// 2026-10-20: 公開前の出典ゲート（~/openclaw-gates/source_gate.py を呼ぶ・決定論）。止めたら false
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OWN = ["note.com/sescore", "qiita.com/sescore", "zenn.dev/ailmarketing", "ses-core"];

// 2026-10-21: facts を渡すと、本文の単位つきの数字を取得した事実と照合する（source_gate.py --facts）
export function assertSources(sources: string[], body: string, dry: boolean, where: string, facts?: string[]): boolean {
  const d = mkdtempSync(join(tmpdir(), "sg-"));
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  writeFileSync(join(d, "body.md"), body);
  writeFileSync(join(d, "src.json"), JSON.stringify((sources ?? []).map((u) => ({ url: u, checked: today }))));
  const args = [join(process.env.HOME ?? "", "openclaw-gates/source_gate.py"), join(d, "body.md"), "--sources", join(d, "src.json")];
  if (facts) {
    writeFileSync(join(d, "facts.json"), JSON.stringify(facts));
    args.push("--facts", join(d, "facts.json"));
  }
  for (const o of OWN) args.push("--own", o);
  try {
    console.log(execFileSync("/usr/bin/python3", args, { encoding: "utf8" }).trim());
    return true;
  } catch (e: any) {
    console.log(`[source-gate] ${where} BLOCK ${(e?.stdout ?? "").toString().trim()}`);
    if (dry) { console.log("[source-gate] dry-run なので続ける（公開はしない）"); return true; }
    return false;
  }
}
