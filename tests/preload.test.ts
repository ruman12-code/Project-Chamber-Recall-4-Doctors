import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNELS } from '../src/shared/ipc';

/**
 * The sandboxed preload cannot import shared/ipc.ts, so it writes the
 * channel names out as literals. This test is what keeps the two copies
 * honest.
 *
 * It exists because of a real failure during milestone 1: the preload
 * imported a project file, the sandbox refused to load it, the bridge
 * silently never appeared, and the application sat on "Starting..."
 * with no visible error at all.
 */
describe('the bridge between the screen and the database', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'preload', 'index.ts'), 'utf8');

  for (const [name, channel] of Object.entries(CHANNELS)) {
    test(`the preload still handles the '${name}' channel`, () => {
      assert.ok(source.includes(`'${channel}'`),
        `the preload does not mention '${channel}'; shared/ipc.ts and the preload have drifted apart`);
    });
  }

  test('the preload requires nothing from this project at run time', () => {
    // A sandboxed preload may only require 'electron'. Any other
    // require here breaks the bridge without any visible error.
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\s)[^;]+from\s+'([^']+)'/gm)].map((m) => m[1]);
    assert.deepEqual(runtimeImports, ['electron']);
  });
});
