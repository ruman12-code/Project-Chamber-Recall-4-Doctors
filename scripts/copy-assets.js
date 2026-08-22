// schema.sql is a plain text file that the compiled code reads at run
// time. TypeScript does not copy it, so this does. Kept as a separate
// visible step rather than hidden inside a bundler.
const { copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const from = join(__dirname, '..', 'src', 'main', 'db', 'schema.sql');
const toDir = join(__dirname, '..', 'out', 'src', 'main', 'db');
mkdirSync(toDir, { recursive: true });
copyFileSync(from, join(toDir, 'schema.sql'));
console.log('copied schema.sql');
