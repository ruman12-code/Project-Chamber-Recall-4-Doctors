import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { setMeta, type Db } from '../src/main/db/open';
import { seedDatabase, PRACTICE_STAFF } from '../src/main/seed/seed';
import { SeedRefusedError } from '../src/shared/errors';
import { tempDir } from './helpers';
import { dataMode } from '../src/main/db/open';
import { loadRulebookFromDisk } from '../src/main/redflags/store';
import { signInList, allStaff, addStaff } from '../src/main/auth/staff';
import { signIn } from '../src/main/auth/session';

/** A fresh practice installation, with its own folder and rules file. */
function freshDemo() {
  const t = tempDir();
  const { db } = provision(t.dir, 'a passphrase for the pilot', 'demo');
  return { db, dir: t.dir, cleanup: t.cleanup };
}

describe('synthetic practice data', () => {
  let db: Db;
  let cleanup: () => void;
  let result: ReturnType<typeof seedDatabase>;

  before(() => {
    const t = tempDir();
    cleanup = t.cleanup;
    db = provision(t.dir, 'practice', 'demo').db;
    // 120 rather than 300 so the test suite stays quick. The shape of
    // the data is what is being checked, not the volume.
    result = seedDatabase(db, { patientCount: 120, randomSeed: 12345 });
  });
  after(() => { db.close(); cleanup(); });

  test('produces two chambers and four years of history', () => {
    assert.equal(result.chambers, 2);
    const span = db.prepare('SELECT min(visit_date) AS first, max(visit_date) AS last FROM visit').get() as { first: string; last: string };
    const yearsCovered = (new Date(span.last).getTime() - new Date(span.first).getTime()) / (365.25 * 24 * 3600 * 1000);
    assert.ok(yearsCovered > 3.5, `history spans only ${yearsCovered.toFixed(1)} years`);
  });

  test('every patient has between one and eight visits in the history', () => {
    // Today's session is counted separately: a patient who already had
    // eight visits and comes in again today has nine, which is correct.
    const today = new Date().toISOString().slice(0, 10);
    const rows = db.prepare('SELECT patient_id, count(*) AS n FROM visit WHERE visit_date != ? GROUP BY patient_id')
      .all(today) as Array<{ n: number }>;
    assert.ok(rows.every((r) => r.n >= 1 && r.n <= 8), 'a patient has more historical visits than the seed should produce');
    assert.equal(rows.length, result.patients);
  });

  test('there is a session running today, with people waiting and one in the chamber', () => {
    // Without this, the Recall Card and the queue have nothing to show:
    // every seeded visit would be in the past.
    const today = new Date().toISOString().slice(0, 10);
    const byStatus = db.prepare(`SELECT status, count(*) AS n FROM visit WHERE visit_date = ? GROUP BY status`)
      .all(today) as Array<{ status: string; n: number }>;
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
    assert.equal(counts['in_chamber'], 1, 'exactly one patient is with the doctor');
    assert.ok((counts['waiting'] ?? 0) > 0, 'somebody is waiting');
    assert.ok((counts['done'] ?? 0) > 0, 'somebody has already been seen');
  });

  test('one patient today has no intake at all, so the unscreened case is visible', () => {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare(`SELECT count(*) AS n FROM visit v
      WHERE v.visit_date = ? AND NOT EXISTS (SELECT 1 FROM intake i WHERE i.visit_id = v.id)`)
      .get(today) as { n: number };
    assert.ok(row.n >= 1);
  });

  test('the patient in the chamber has history worth recalling', () => {
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare(`SELECT count(*) AS n FROM visit
      WHERE patient_id = (SELECT patient_id FROM visit WHERE visit_date = ? AND status = 'in_chamber')`)
      .get(today) as { n: number };
    assert.ok(row.n >= 5, `the patient in the chamber has only ${row.n} visits, which makes a poor Recall Card`);
  });

  test('serial numbers run 1..n within each chamber on each day, with no gaps or repeats', () => {
    // This is the property the paper register guarantees, so the
    // database has to guarantee it too.
    const days = db.prepare(`SELECT chamber_id, visit_date, count(*) AS n, count(DISTINCT serial_no) AS distinct_serials,
                                    min(serial_no) AS lo, max(serial_no) AS hi
                             FROM visit GROUP BY chamber_id, visit_date`).all() as Array<{ n: number; distinct_serials: number; lo: number; hi: number }>;
    assert.ok(days.length > 0);
    for (const d of days) {
      assert.equal(d.distinct_serials, d.n, 'a serial was issued twice on one day');
      assert.equal(d.lo, 1, 'serials do not start at 1');
      assert.equal(d.hi, d.n, 'there is a gap in the serials');
    }
  });

  describe('the awkward cases the software has to survive are present', () => {
    test('some patients share a phone number with a relative', () => {
      const shared = db.prepare(`SELECT phone, count(*) AS n FROM patient WHERE phone IS NOT NULL GROUP BY phone HAVING n > 1`).all();
      assert.ok(shared.length > 0, 'no shared handsets, so patient search cannot be tested honestly');
    });

    test('some patients have no phone number at all', () => {
      const row = db.prepare('SELECT count(*) AS n FROM patient WHERE phone IS NULL').get() as { n: number };
      assert.ok(row.n > 0);
    });

    test('duplicate patient records exist for the merge tool to be tested against', () => {
      assert.ok(result.duplicatePairs >= 4);
    });

    test('some ages are approximate, and carry the date they were taken', () => {
      const approx = db.prepare('SELECT count(*) AS n FROM patient WHERE approx_age_years IS NOT NULL').get() as { n: number };
      const orphaned = db.prepare('SELECT count(*) AS n FROM patient WHERE approx_age_years IS NOT NULL AND approx_age_recorded_on IS NULL').get() as { n: number };
      assert.ok(approx.n > 0);
      assert.equal(orphaned.n, 0);
    });

    test('there are investigations ordered with no result recorded', () => {
      // The highest-value block on the Recall Card needs real ones.
      const row = db.prepare('SELECT count(*) AS n FROM investigation WHERE result_date IS NULL').get() as { n: number };
      assert.ok(row.n > 0);
      assert.equal(row.n, result.outstandingInvestigations);
    });

    test('some intakes were abandoned partway, which is an acceptable outcome', () => {
      const row = db.prepare('SELECT count(*) AS n FROM intake WHERE completed_at IS NULL').get() as { n: number };
      assert.ok(row.n > 0);
    });

    test('some questions were skipped, and a skip is recorded as a fact', () => {
      const skipped = db.prepare('SELECT count(*) AS n FROM intake_answer WHERE was_skipped = 1').get() as { n: number };
      assert.ok(skipped.n > 0, 'nothing was skipped, so skip reporting cannot be tested');
    });

    test('some encounters are left unconfirmed by the doctor', () => {
      const row = db.prepare('SELECT count(*) AS n FROM encounter WHERE doctor_confirmed_at IS NULL').get() as { n: number };
      assert.ok(row.n > 0);
    });

    test('research consent is recorded separately from clinical consent', () => {
      const both = db.prepare(`SELECT count(*) AS n FROM intake WHERE consent_given_at IS NOT NULL AND research_consent_given_at IS NULL`).get() as { n: number };
      assert.ok(both.n > 0, 'research consent must not be implied by clinical consent');
    });

    test('the two front desk assistants behave measurably differently', () => {
      // If this ever becomes false, the pilot report cannot show what it
      // exists to show, and averaging the assistants together would look
      // perfectly reasonable.
      const perAssistant = db.prepare(`
        SELECT actor_id, count(*) AS n, avg(duration_ms) AS mean_ms
        FROM usage_event WHERE event_type = 'intake_completed' GROUP BY actor_id`).all() as Array<{ n: number; mean_ms: number }>;
      assert.equal(perAssistant.length, 2);
      const [a, b] = perAssistant.sort((x, y) => x.mean_ms - y.mean_ms);
      assert.ok(b!.mean_ms > a!.mean_ms * 1.4, 'the two assistants take suspiciously similar times');
    });
  });

  test('vitals move in a trend rather than jumping around at random', () => {
    // A sparkline drawn from random numbers looks broken, and the
    // reviewer would be judging the chart when the fault was the data.
    const patient = db.prepare(`
      SELECT v.patient_id AS pid, count(*) AS n FROM vitals vi JOIN visit v ON v.id = vi.visit_id
      WHERE vi.systolic_bp IS NOT NULL GROUP BY v.patient_id HAVING n >= 5 LIMIT 1`).get() as { pid: string } | undefined;
    assert.ok(patient, 'no patient has enough readings to draw a trend');

    const readings = db.prepare(`
      SELECT vi.systolic_bp AS bp FROM vitals vi JOIN visit v ON v.id = vi.visit_id
      WHERE v.patient_id = ? AND vi.systolic_bp IS NOT NULL ORDER BY v.visit_date`).all(patient!.pid) as Array<{ bp: number }>;

    const steps = readings.slice(1).map((r, i) => Math.abs(r.bp - readings[i]!.bp));
    const meanStep = steps.reduce((s, x) => s + x, 0) / steps.length;
    assert.ok(meanStep < 25, `readings jump by ${meanStep.toFixed(0)} on average, which is noise rather than a trend`);
  });

  test('the seeding is recorded in the audit log', () => {
    const row = db.prepare(`SELECT count(*) AS n FROM audit_log WHERE action = 'database_seeded'`).get() as { n: number };
    assert.equal(row.n, 1);
  });

  test('no clinical placeholder text escaped into the patient-facing fields', () => {
    // Complaints, worries and hopes are the patient's own words and
    // must never contain my placeholder strings.
    const leaked = db.prepare(`SELECT count(*) AS n FROM intake_answer
      WHERE question_key IN ('presenting_complaint','most_worried_about','hoping_for')
        AND answer_free_text LIKE 'PLACEHOLDER%'`).get() as { n: number };
    assert.equal(leaked.n, 0);
  });
});

describe('practice data can never reach a real patient database', () => {
  test('seeding is refused on a database marked live', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'live').db;
    assert.throws(() => seedDatabase(db, { patientCount: 5 }), SeedRefusedError);
    db.close(); t.cleanup();
  });

  test('seeding is refused on a database that already has patients in it', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    seedDatabase(db, { patientCount: 5 });
    assert.throws(() => seedDatabase(db, { patientCount: 5 }), SeedRefusedError);
    db.close(); t.cleanup();
  });

  test('the refusal explains what to do instead', () => {
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    setMeta(db, 'data_mode', 'live');
    try {
      seedDatabase(db, { patientCount: 5 });
      assert.fail('expected a refusal');
    } catch (error) {
      assert.ok(error instanceof SeedRefusedError);
      assert.match(error.whatToDo, /demo/i);
    }
    db.close(); t.cleanup();
  });
});

describe('the same seed value always produces the same data', () => {
  test('two databases seeded identically hold identical patients', () => {
    // So that a bug seen in a demo can be reproduced exactly.
    const names = [0, 1].map(() => {
      const t = tempDir();
      const db = provision(t.dir, 'passphrase', 'demo').db;
      seedDatabase(db, { patientCount: 30, randomSeed: 777 });
      const rows = db.prepare('SELECT full_name_en, phone FROM patient ORDER BY created_at, full_name_en').all();
      db.close(); t.cleanup();
      return JSON.stringify(rows);
    });
    assert.equal(names[0], names[1]);
  });
});

describe('the practice data is realistic enough to judge screens against', () => {
  test('names are varied, so accidental collisions do not swamp deliberate duplicates', () => {
    // An earlier generator drew from a list of sixteen whole names, and
    // seventeen different patients ended up with the identical full
    // name. The search screen and the merge tool were then impossible
    // to assess: every result looked like a duplicate.
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    seedDatabase(db, { patientCount: 300, randomSeed: 4242 });

    const worst = db.prepare(
      `SELECT count(*) AS n FROM patient GROUP BY full_name_bn ORDER BY n DESC LIMIT 1`).get() as { n: number };
    assert.ok(worst.n <= 6, `${worst.n} patients share one name, which makes the search screen unreadable`);

    const distinct = db.prepare('SELECT count(DISTINCT full_name_bn) AS n FROM patient').get() as { n: number };
    assert.ok(distinct.n > 150, `only ${distinct.n} distinct names among 300 patients`);

    db.close(); t.cleanup();
  });
});

describe('the deliberate duplicates are usable for testing the merge tool', () => {
  test('a duplicate is visibly different from the record it duplicates', () => {
    // A duplicate that differs only by an invisible trailing space
    // proves nothing about the merge tool, and looks like a rendering
    // fault rather than a data problem.
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    seedDatabase(db, { patientCount: 200, randomSeed: 99 });

    const pairs = db.prepare(`
      SELECT a.full_name_en AS one, b.full_name_en AS two
      FROM patient a JOIN patient b ON a.full_name_bn = b.full_name_bn AND a.id < b.id
      WHERE a.full_name_en != b.full_name_en`).all() as Array<{ one: string; two: string }>;
    assert.ok(pairs.length > 0, 'no differently-spelled duplicate pairs exist at all');

    for (const pair of pairs) {
      assert.notEqual(pair.one.trim(), pair.two.trim(),
        `"${pair.one}" and "${pair.two}" differ only by whitespace, which nobody can see on screen`);
    }
    db.close(); t.cleanup();
  });
});

describe("today's session looks like an evening in progress", () => {
  test('patients arrived in the past, so waiting times are real numbers', () => {
    // A session pinned to a fixed hour shows everybody as having waited
    // zero minutes whenever the demo is opened before that hour, and
    // "how long has this person been waiting" is the whole point of a
    // live queue.
    const t = tempDir();
    const db = provision(t.dir, 'passphrase', 'demo').db;
    seedDatabase(db, { patientCount: 60, randomSeed: 31337 });

    const today = new Date().toISOString().slice(0, 10);
    const rows = db.prepare(
      `SELECT arrived_at AS arrivedAt, seen_at AS seenAt, status FROM visit WHERE visit_date = ?`).all(today) as
      Array<{ arrivedAt: string; seenAt: string | null; status: string }>;
    assert.ok(rows.length > 0);

    const now = Date.now();
    for (const row of rows) {
      assert.ok(new Date(row.arrivedAt).getTime() < now, `a patient arrived in the future: ${row.arrivedAt}`);
      if (row.seenAt !== null) {
        assert.ok(new Date(row.seenAt).getTime() <= now, `a patient was seen in the future: ${row.seenAt}`);
        assert.ok(new Date(row.seenAt).getTime() >= new Date(row.arrivedAt).getTime(),
          'a patient was seen before they arrived');
      }
    }

    const waiting = rows.filter((r) => r.status === 'waiting');
    const longestWait = Math.max(...waiting.map((r) => now - new Date(r.arrivedAt).getTime()));
    assert.ok(longestWait > 20 * 60000, 'nobody has been waiting long enough to be worth showing');

    db.close(); t.cleanup();
  });
});

describe('the practice PINs on the sign-in screen', () => {
  // Being locked out of a database full of invented people is a silly
  // way to lose an evening, so a practice database shows the PINs. The
  // thing that must never happen is that reaching a REAL person's PIN.

  test('every practice person the seed creates is in PRACTICE_STAFF', () => {
    const { db, dir, cleanup } = freshDemo();
    const rulebook = loadRulebookFromDisk(dir).rulebook!;
    seedDatabase(db, { patientCount: 5, rulebook });

    const names = signInList(db).map((p) => p.displayName).sort();
    const declared = PRACTICE_STAFF.map((p) => p.display_name).sort();
    assert.deepEqual(names, declared,
      'the seed and PRACTICE_STAFF have drifted apart, so the screen would show a wrong PIN');
    db.close(); cleanup();
  });

  test('each declared PIN actually signs that person in', () => {
    const { db, dir, cleanup } = freshDemo();
    const rulebook = loadRulebookFromDisk(dir).rulebook!;
    seedDatabase(db, { patientCount: 5, rulebook });

    for (const person of signInList(db)) {
      const declared = PRACTICE_STAFF.find((p) => p.display_name === person.displayName)!;
      const who = signIn(db, person.id, declared.pin);
      assert.equal(who.displayName, person.displayName,
        `the PIN printed for ${person.displayName} does not sign them in`);
    }
    db.close(); cleanup();
  });

  test('a PIN nobody declared does not sign anybody in', () => {
    const { db, dir, cleanup } = freshDemo();
    const rulebook = loadRulebookFromDisk(dir).rulebook!;
    seedDatabase(db, { patientCount: 5, rulebook });
    const person = signInList(db)[0]!;
    assert.throws(() => signIn(db, person.id, '0000'));
    db.close(); cleanup();
  });

  test('a live database has no practice staff for a PIN to be shown for', () => {
    // The screen only ever shows a PIN for a name in PRACTICE_STAFF, and
    // the seed that creates those names refuses to run against a live
    // database. So on a live database there is nothing to match.
    const { dir, cleanup } = tempDir();
    const { db } = provision(dir, 'a passphrase for the pilot', 'live');
    assert.equal(dataMode(db), 'live');
    assert.throws(() => seedDatabase(db, { patientCount: 5 }), SeedRefusedError);

    addStaff(db, { displayName: 'Dr Real Person', role: 'doctor', pin: '9182' }, { id: null, role: 'system' });
    const names = allStaff(db).map((p) => p.displayName);
    for (const declared of PRACTICE_STAFF) {
      assert.ok(!names.includes(declared.display_name),
        'a live database must never contain a name the screen would print a PIN for');
    }
    db.close(); cleanup();
  });
});
