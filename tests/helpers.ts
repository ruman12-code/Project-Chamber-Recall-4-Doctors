import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'chamber-recall-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
