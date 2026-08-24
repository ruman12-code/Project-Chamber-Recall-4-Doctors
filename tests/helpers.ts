import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'chamber-recall-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Replace a fragment of a file's text, and fail loudly when the
 * fragment is not there.
 *
 * String.replace returns the string unchanged when nothing matched, so
 * a test that edits a file and then checks the result can quietly end
 * up checking the ORIGINAL file and passing for the wrong reason - or,
 * as happened here, failing on one platform for a reason nothing in the
 * failure message mentions.
 *
 * The text is normalised to LF first, so a checkout with CRLF line
 * endings behaves the same as one without.
 */
export function editing(text: string, find: string, replaceWith: string): string {
  const normalised = text.replace(/\r\n/g, '\n');
  if (!normalised.includes(find)) {
    throw new Error(
      `This test meant to edit the file by replacing:\n\n${find}\n\n` +
      `...but that is not in the file, so nothing was edited and whatever ` +
      `this test goes on to check would be checking the original.`,
    );
  }
  return normalised.replace(find, replaceWith);
}
