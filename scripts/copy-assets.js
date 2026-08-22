// schema.sql and the migration files are plain text read at run time.
// TypeScript does not copy them, so this does. Kept as a visible step
// rather than hidden inside a bundler.
const { copyFileSync, mkdirSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const srcDb = join(__dirname, '..', 'src', 'main', 'db');
const outDb = join(__dirname, '..', 'out', 'src', 'main', 'db');

mkdirSync(outDb, { recursive: true });
copyFileSync(join(srcDb, 'schema.sql'), join(outDb, 'schema.sql'));

mkdirSync(join(outDb, 'migrations'), { recursive: true });
let n = 0;
for (const file of readdirSync(join(srcDb, 'migrations'))) {
  if (!file.endsWith('.sql')) continue;
  copyFileSync(join(srcDb, 'migrations', file), join(outDb, 'migrations', file));
  n += 1;
}

// The red flag rules template ships with the application and is copied
// into the doctor's data folder the first time it runs.
mkdirSync(join(__dirname, '..', 'out', 'config'), { recursive: true });
copyFileSync(join(__dirname, '..', 'config', 'red_flags.yaml'),
             join(__dirname, '..', 'out', 'config', 'red_flags.yaml'));

console.log(`copied schema.sql, ${n} migration(s), red_flags.yaml`);
