import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { provision } from '../src/main/db/provision';
import { nowIso, localDate } from '../src/main/db/clock';
import { registerPatient } from '../src/main/patients/register';
import { registerArrival, setVisitStatus } from '../src/main/queue/register';
import { moveInQueue, todaysQueue } from '../src/main/queue/queue';
import { deskSignal } from '../src/main/queue/deskSignal';
import { recordNoAnswer, timesCalled, noAnswerCounts, NoAnswerError } from '../src/main/queue/noAnswer';
import { addStaff } from '../src/main/auth/staff';
import { recentAudit } from '../src/main/db/audit';
import { tempDir } from './helpers';

const SYSTEM = { id: null, role: 'system' as const };
const TODAY = localDate();

function chamber() {
  const t = tempDir();
  const { db } = provision(t.dir, 'the pilot passphrase', 'demo');
  db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
    .run('popular', 'Popular', nowIso());
  const doctorId = addStaff(db, { displayName: 'Dr Test', role: 'doctor', pin: '4021' }, SYSTEM);
  const doctor = { id: doctorId, role: 'doctor' as const };
  const deskId = addStaff(db, { displayName: 'Biplob', role: 'front_desk', pin: '6172' }, doctor);
  const visits: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const p = registerPatient(db, {
      fullNameBn: `রোগী ${i}`, fullNameEn: null, phone: null, dob: null,
      approxAgeYears: 30 + i, sex: 'female', addressFreeText: null,
    }, doctor);
    visits.push(registerArrival(db, p, 'popular', doctor).visitId);
  }
  return { db, doctor, deskId, visits, cleanup: () => { db.close(); t.cleanup(); } };
}

let n = 0;
const ref = () => `desk-ref-${++n}`;

/** waiting -> in_chamber -> done, which is the only way through. */
function seen(c: ReturnType<typeof chamber>, visitId: string) {
  setVisitStatus(c.db, visitId, 'in_chamber', c.doctor);
  setVisitStatus(c.db, visitId, 'done', c.doctor);
}

function nobodyCame(c: ReturnType<typeof chamber>, visitId: string) {
  return recordNoAnswer(c.db, {
    deskRef: ref(), visitId, calledBy: c.deskId, calledAt: nowIso(),
  });
}

describe('the number was called and nobody came', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.cleanup(); });

  test('the visit is not touched in any way', () => {
    const before_ = c.db.prepare('SELECT * FROM visit WHERE id = ?').get(c.visits[0]!);
    nobodyCame(c, c.visits[0]!);
    const after_ = c.db.prepare('SELECT * FROM visit WHERE id = ?').get(c.visits[0]!);
    // Every column, not just the ones somebody thought to check. This
    // is the whole design: nobody is dropped for being in the toilet.
    assert.deepEqual(after_, before_);
  });

  test('and it is counted', () => {
    assert.equal(timesCalled(c.db, c.visits[0]!), 1);
    nobodyCame(c, c.visits[0]!);
    assert.equal(timesCalled(c.db, c.visits[0]!), 2);
  });

  test('the same report twice is the same call, not two', () => {
    const twice = ref();
    const first = recordNoAnswer(c.db, {
      deskRef: twice, visitId: c.visits[1]!, calledBy: c.deskId, calledAt: nowIso(),
    });
    const again = recordNoAnswer(c.db, {
      deskRef: twice, visitId: c.visits[1]!, calledBy: c.deskId, calledAt: nowIso(),
    });
    assert.equal(first.alreadyHad, false);
    assert.equal(again.alreadyHad, true);
    assert.equal(first.times, again.times);
    assert.equal(timesCalled(c.db, c.visits[1]!), 1);
  });

  test('it carries the name of whoever called the number out', () => {
    const row = c.db.prepare(
      'SELECT called_by AS by FROM call_no_answer WHERE visit_id = ? LIMIT 1',
    ).get(c.visits[1]!) as { by: string };
    assert.equal(row.by, c.deskId);
  });

  test('a name nobody has is refused rather than recorded against nobody', () => {
    assert.throws(
      () => recordNoAnswer(c.db, {
        deskRef: ref(), visitId: c.visits[2]!, calledBy: 'nobody-at-all', calledAt: nowIso(),
      }),
      NoAnswerError,
    );
    assert.equal(timesCalled(c.db, c.visits[2]!), 0);
  });

  test('a visit that is not there is refused', () => {
    assert.throws(
      () => recordNoAnswer(c.db, {
        deskRef: ref(), visitId: 'no-such-visit', calledBy: c.deskId, calledAt: nowIso(),
      }),
      NoAnswerError,
    );
  });

  test('the audit says the visit came out of it unchanged', () => {
    const entry = recentAudit(c.db, 200).find((a) => a.action === 'called_no_answer');
    assert.ok(entry !== undefined, 'nothing was written to the audit');
    assert.equal(entry!.entity, 'visit');
  });

  test('nothing is hard deleted', () => {
    const rows = c.db.prepare('SELECT count(*) AS n FROM call_no_answer').get() as { n: number };
    assert.ok(rows.n >= 3);
  });
});

describe('who the desk is shown next', () => {
  let c: ReturnType<typeof chamber>;
  before(() => { c = chamber(); });
  after(() => { c.cleanup(); });

  test('the first person waiting, before anybody has been called', () => {
    assert.equal(deskSignal(c.db, 'popular', TODAY).nextWaiting?.serialNo, 1);
    assert.equal(deskSignal(c.db, 'popular', TODAY).nextWaiting?.noAnswer, 0);
  });

  test('nobody came for 1, so the desk is shown 2 -- and 1 is still waiting', () => {
    nobodyCame(c, c.visits[0]!);
    const signal = deskSignal(c.db, 'popular', TODAY);
    assert.equal(signal.nextWaiting?.serialNo, 2);
    assert.equal(signal.waiting, 4, 'somebody was dropped from the queue');
    const one = c.db.prepare('SELECT status FROM visit WHERE id = ?').get(c.visits[0]!) as { status: string };
    assert.equal(one.status, 'waiting');
  });

  test('everybody gets a second call before anybody gets a third', () => {
    nobodyCame(c, c.visits[1]!);
    assert.equal(deskSignal(c.db, 'popular', TODAY).nextWaiting?.serialNo, 3);
    nobodyCame(c, c.visits[2]!);
    assert.equal(deskSignal(c.db, 'popular', TODAY).nextWaiting?.serialNo, 4);
    nobodyCame(c, c.visits[3]!);
    // Round again, from the top, because somebody outside on the phone
    // is usually back by now.
    const signal = deskSignal(c.db, 'popular', TODAY);
    assert.equal(signal.nextWaiting?.serialNo, 1);
    assert.equal(signal.nextWaiting?.noAnswer, 1, 'the screen has to say this is the second call');
  });

  test('a patient moved up by a red flag still comes first when calls are level', () => {
    // Serial 4 to the top. Everybody is on one unanswered call, so the
    // tie is broken by queue position and the escalated patient wins.
    moveInQueue(c.db, c.visits[3]!, 'up', c.doctor);
    moveInQueue(c.db, c.visits[3]!, 'up', c.doctor);
    moveInQueue(c.db, c.visits[3]!, 'up', c.doctor);
    assert.equal(deskSignal(c.db, 'popular', TODAY).nextWaiting?.serialNo, 4);
  });

  test('being called and not answering never costs a patient their place', () => {
    // Serial 4 is at the top of the queue and has one unanswered call.
    // Call it again: it goes to the back of the CALLING order, and not
    // one place in the queue itself.
    const before_ = c.db.prepare(
      'SELECT queue_position AS pos, serial_no AS serial FROM visit WHERE id = ?',
    ).get(c.visits[3]!);
    nobodyCame(c, c.visits[3]!);
    const after_ = c.db.prepare(
      'SELECT queue_position AS pos, serial_no AS serial FROM visit WHERE id = ?',
    ).get(c.visits[3]!);
    assert.deepEqual(after_, before_);
    // And the doctor calling them in still works, out of turn or not.
    setVisitStatus(c.db, c.visits[3]!, 'in_chamber', c.doctor);
    assert.equal(deskSignal(c.db, 'popular', TODAY).inChamber?.serialNo, 4);
  });

  test('one person left waiting says so, rather than looking stuck', () => {
    const c2 = chamber();
    for (const v of c2.visits.slice(1)) seen(c2, v);
    const signal = deskSignal(c2.db, 'popular', TODAY);
    assert.equal(signal.nextWaiting?.onlyOneWaiting, true);
    c2.cleanup();
  });

  test('the fingerprint changes on a second unanswered call to the same person', () => {
    const c2 = chamber();
    for (const v of c2.visits.slice(1)) seen(c2, v);
    const first = deskSignal(c2.db, 'popular', TODAY).at;
    recordNoAnswer(c2.db, { deskRef: ref(), visitId: c2.visits[0]!, calledBy: c2.deskId, calledAt: nowIso() });
    const second = deskSignal(c2.db, 'popular', TODAY).at;
    assert.notEqual(first, second, 'the tablet would never have shown the second call');
    c2.cleanup();
  });
});

describe('what the doctor sees on his own list', () => {
  test('the count is on the row, and only while they are still waiting', () => {
    const c = chamber();
    nobodyCame(c, c.visits[0]!);
    nobodyCame(c, c.visits[0]!);

    const waiting = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[0]);
    assert.equal(waiting?.calledNoAnswer, 2);
    assert.equal(waiting?.status, 'waiting');

    const untouched = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[1]);
    assert.equal(untouched?.calledNoAnswer, 0);

    // They turn up after all. The count stays -- it happened -- and the
    // doctor can still see it, but nothing about it stopped them being
    // seen.
    setVisitStatus(c.db, c.visits[0]!, 'in_chamber', c.doctor);
    const seen = todaysQueue(c.db, 'popular', TODAY).find((e) => e.visitId === c.visits[0]);
    assert.equal(seen?.calledNoAnswer, 2);
    assert.equal(seen?.status, 'in_chamber');
    c.cleanup();
  });

  test('counts belong to their own chamber and their own day', () => {
    const c = chamber();
    c.db.prepare('INSERT INTO chamber (id, name, created_at) VALUES (?, ?, ?)')
      .run('lubana', 'Lubana', nowIso());
    nobodyCame(c, c.visits[0]!);
    assert.equal(noAnswerCounts(c.db, 'popular', TODAY).size, 1);
    assert.equal(noAnswerCounts(c.db, 'lubana', TODAY).size, 0);
    assert.equal(noAnswerCounts(c.db, 'popular', '2020-01-01').size, 0);
    c.cleanup();
  });
});
