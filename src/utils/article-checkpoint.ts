import { mkdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Recovery evidence only. No publisher imports, retries, or approval decisions. */
export function createArticleCheckpoint(root: string, article: unknown, dryRun: boolean) {
  const dir = join(root, randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const data: Record<string, unknown> = {
    version: 1, createdAt: new Date().toISOString(), dryRun,
    automaticReplayAllowed: false, stage: 'generated_unreviewed', article: structuredClone(article),
  };
  function save(stage: string, fields: Record<string, unknown> = {}) {
    Object.assign(data, structuredClone(fields), { stage, updatedAt: new Date().toISOString() });
    const temp = join(dir, 'checkpoint.tmp');
    writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    const fd = openSync(temp, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, join(dir, 'checkpoint.json'));
  }
  save('generated_unreviewed');
  return { dir, save };
}
