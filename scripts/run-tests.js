// ===================================================================
// Runs the checks, and fails when any of them fail.
//
// That should not need saying, but it does. Node's own test runner has
// a hole in it: when the SETUP of a group throws - the rows a group of
// tests needs, written before the tests themselves run - the group is
// printed as "not ok", and then the run exits 0 and the summary says
// "fail 0".
//
//   describe('nothing is ever hard deleted', () => {
//     ...insert a row here, and if that throws...
//   });
//
// A whole group of checks stopped running when a column was renamed,
// the summary said everything passed, and it stayed that way for two
// milestones. This project's first rule is that nothing fails silently,
// so the runner cannot be one of the things that does.
//
// The rule here is blunt on purpose: if the word "not ok" appears
// anywhere in the output, the run failed.
// ===================================================================
const { spawn } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { join } = require('node:path');

const testDir = join(__dirname, '..', 'out', 'tests');
const files = readdirSync(testDir).filter((f) => f.endsWith('.test.js')).map((f) => join(testDir, f));

if (files.length === 0) {
  console.error('\nNo compiled tests found in out/tests. Run "npm run build:main" first.\n');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...files], { stdio: ['inherit', 'pipe', 'inherit'] });

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});

child.on('close', (code) => {
  const notOk = output.split('\n').filter((line) => /^\s*not ok /.test(line));
  if (notOk.length > 0) {
    console.error(`\n${notOk.length} check${notOk.length === 1 ? '' : 's'} failed:\n`);
    for (const line of notOk) console.error(`  ${line.trim()}`);
    console.error('');
    process.exit(1);
  }
  if (code !== 0) {
    console.error(`\nThe test runner exited with code ${code}.\n`);
    process.exit(code ?? 1);
  }
});
