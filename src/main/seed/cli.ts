// ===================================================================
// Command line: build a demo database full of practice data.
// ===================================================================
//   npm run seed -- --dir ./data/demo --passphrase practice
//
// This never touches a live database: it creates a brand new one in
// demo mode, and seedDatabase() refuses to run against anything else.
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { provision, isProvisioned } from '../db/provision';
import { loadRulebookFromDisk } from '../redflags/store';
import { seedDatabase } from './seed';
import { loadConsentConfig } from '../consent/config';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

function main(): void {
  const dir = resolve(arg('dir', './data/demo'));
  const passphrase = arg('passphrase', 'practice');
  const patientCount = Number(arg('patients', '300'));
  const force = process.argv.includes('--force');

  if (isProvisioned(dir)) {
    if (!force) {
      console.error(`\nThere is already a database in ${dir}.`);
      console.error(`Re-run with --force to delete it and build a fresh demo, or choose another --dir.\n`);
      process.exit(1);
    }
    console.log(`Removing the existing demo database in ${dir}`);
    rmSync(dir, { recursive: true, force: true });
  }
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });

  console.log(`Creating a DEMO database in ${dir}`);
  const started = Date.now();
  const { db, recoveryKey } = provision(dir, passphrase, 'demo');

  // provision() has just put the rules template in the data folder.
  // The practice data is screened with those rules, through exactly the
  // code a real intake uses.
  const { rulebook, problems } = loadRulebookFromDisk(dir);
  if (rulebook === null) {
    console.error('\nThe red flag rules file could not be read, so the practice data cannot be screened:\n');
    for (const p of problems) console.error(`  line ${p.line ?? '?'}: ${p.problem}\n    ${p.whatToDo}`);
    process.exit(1);
  }

  // The consent wording that provision() has just installed. The
  // practice patients agree (or refuse) against the real version, so
  // the pilot report and the research export count something true.
  const consent = loadConsentConfig(dir);
  const result = seedDatabase(db, {
    patientCount, rulebook,
    consentVersion: consent.config?.version ?? null,
    onProgress: (m) => console.log(`  ${m}`),
  });
  db.close();

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nDemo database built in ${seconds}s\n`);
  for (const [key, value] of Object.entries(result)) {
    console.log(`  ${key.padEnd(26)} ${value}`);
  }
  console.log(`\n  rules file                 ${rulebook.sourcePath}`);
  console.log(`  rules loaded               ${rulebook.rules.length} (all placeholders)`);
  console.log(`\n  passphrase                 ${passphrase}`);
  console.log(`  recovery key               ${recoveryKey}`);
  console.log(`\n  sign in as                 Dr. Ashraful Haque         PIN 4021`);
  console.log(`                             Nusrat (clinical assistant) PIN 5390`);
  console.log(`                             Jahid (front desk)          PIN 6172`);
  console.log(`                             Shopna (front desk)         PIN 7483`);
  console.log(`\nThis database is marked demo. It can never be used for real patients.\n`);
}

main();
