// ===================================================================
// The consultation.
// ===================================================================
// What the doctor writes about a patient in front of him: the
// complaint, what he found, what he thinks it is, what he decided,
// what he prescribed and what he ordered.
//
// EVERY WORD IN HERE IS TYPED BY A PERSON.
//
// Nothing in this file generates, suggests, completes, ranks, orders,
// scores or infers any of it. There is no drug list to pick from, no
// diagnosis list, no interaction check, no dose calculation. Those are
// not missing features; they are the point. This software records a
// clinician's judgement and never contributes to it.
//
// A draft saves as it is typed and belongs to nobody but the person
// typing until the doctor confirms it. Confirming is the signature,
// and after it the record is locked by the database itself -
// changing a confirmed consultation takes an undo that is recorded,
// so the log holds an amendment rather than a silent rewrite.
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso, localDate } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { recordUsage } from '../db/usage';
import { ChamberRecallError } from '../../shared/errors';
import { requireClinicalRole, requireDoctor } from './access';
import type { EncounterDraft, EncounterView, MedicationInput } from '../../shared/clinical';

export class EncounterError extends ChamberRecallError {}

/**
 * The draft for this visit, made if it does not exist yet.
 *
 * Opening the chamber screen is what creates it, so a power cut thirty
 * seconds into a consultation still leaves a row with the doctor's
 * name on it rather than nothing at all.
 */
export function openEncounter(db: Db, visitId: string, actor: Actor, at: string = nowIso()): string {
  requireClinicalRole(actor, 'record a consultation');

  const existing = db.prepare('SELECT id FROM encounter WHERE visit_id = ? AND deleted_at IS NULL')
    .get(visitId) as { id: string } | undefined;
  if (existing !== undefined) return existing.id;

  const visit = db.prepare('SELECT id FROM visit WHERE id = ? AND deleted_at IS NULL').get(visitId);
  if (visit === undefined) {
    throw new EncounterError('That visit is not there.', 'Go back to today\'s list and open the patient again.');
  }

  const id = newId();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO encounter (id, visit_id, entered_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(id, visitId, actor.id, at, at);
    recordAudit(db, {
      actor, action: 'encounter_started', entity: 'encounter', entityId: id, details: { visit_id: visitId },
    });
  });
  write();
  recordUsage(db, { eventType: 'encounter_started', actorId: actor.id, visitId, timestamp: at });
  return id;
}

function loadOrFail(db: Db, encounterId: string): { id: string; visitId: string; confirmedAt: string | null } {
  const row = db.prepare(
    `SELECT id, visit_id AS visitId, doctor_confirmed_at AS confirmedAt
     FROM encounter WHERE id = ? AND deleted_at IS NULL`,
  ).get(encounterId) as { id: string; visitId: string; confirmedAt: string | null } | undefined;
  if (row === undefined) {
    throw new EncounterError('That consultation is not there.', 'Go back to today\'s list and open the patient again.');
  }
  return row;
}

function refuseIfConfirmed(row: { confirmedAt: string | null }, what: string): void {
  if (row.confirmedAt !== null) {
    throw new EncounterError(
      `This consultation is confirmed, so it cannot be ${what}.`,
      'Press "Undo confirmation" first. That is recorded, and the record then shows an amendment rather than looking as though it was always written this way.',
    );
  }
}

const text = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Autosave. Called while the doctor types, so it does not write an
 * audit entry for every keystroke: a draft is not yet a record. What
 * it does guarantee is that the words are on disk, in the encrypted
 * database, within a second or two of being typed.
 */
export function saveDraft(db: Db, encounterId: string, draft: EncounterDraft, actor: Actor, at: string = nowIso()): void {
  requireClinicalRole(actor, 'write a consultation');
  const row = loadOrFail(db, encounterId);
  refuseIfConfirmed(row, 'changed');

  const days = draft.followUpAfterDays;
  if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) {
    throw new EncounterError(
      'The follow-up has to be a number of days.',
      'Type how many days from today, or leave it empty if there is no follow-up.',
    );
  }

  db.prepare(
    `UPDATE encounter SET chief_complaint = ?, examination_notes = ?, working_diagnosis = ?,
       decision_notes = ?, follow_up_after_days = ?, updated_at = ? WHERE id = ?`,
  ).run(text(draft.chiefComplaint), text(draft.examinationNotes), text(draft.workingDiagnosis),
    text(draft.decisionNotes), days ?? null, at, encounterId);
}

/**
 * The prescription, replaced as a whole.
 *
 * Lines are held in the order the doctor put them in, because a
 * prescription is read down the page and the order is his.
 */
export function setMedications(db: Db, encounterId: string, lines: MedicationInput[], actor: Actor, at: string = nowIso()): void {
  requireClinicalRole(actor, 'prescribe');
  const row = loadOrFail(db, encounterId);
  refuseIfConfirmed(row, 'changed');

  const clean = lines
    .map((line) => ({ ...line, drugName: line.drugName.trim() }))
    .filter((line) => line.drugName !== '');

  const write = db.transaction(() => {
    db.prepare('UPDATE medication SET deleted_at = ?, updated_at = ? WHERE encounter_id = ? AND deleted_at IS NULL')
      .run(at, at, encounterId);
    let order = 0;
    for (const line of clean) {
      db.prepare(
        `INSERT INTO medication (id, encounter_id, drug_name, strength, dose, frequency, duration_days,
           instructions, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(newId(), encounterId, line.drugName, text(line.strength), text(line.dose), text(line.frequency),
        line.durationDays ?? null, text(line.instructions), order, at, at);
      order += 1;
    }
    recordAudit(db, {
      actor, action: 'prescription_written', entity: 'encounter', entityId: encounterId,
      details: { lines: clean.length },
    });
  });
  write();
}

export function setInvestigations(db: Db, encounterId: string, names: string[], actor: Actor, at: string = nowIso()): void {
  requireClinicalRole(actor, 'order tests');
  const row = loadOrFail(db, encounterId);
  refuseIfConfirmed(row, 'changed');

  const clean = names.map((n) => n.trim()).filter((n) => n !== '');
  const orderedDate = localDate(new Date(at));

  const write = db.transaction(() => {
    // A test that already has a result is never removed by editing the
    // list: the result is a fact about the patient and does not belong
    // to this screen any more.
    db.prepare(
      `UPDATE investigation SET deleted_at = ?, updated_at = ?
       WHERE encounter_id = ? AND deleted_at IS NULL AND result_date IS NULL`,
    ).run(at, at, encounterId);
    for (const name of clean) {
      const kept = db.prepare(
        `SELECT id FROM investigation WHERE encounter_id = ? AND test_name = ? AND deleted_at IS NULL`,
      ).get(encounterId, name);
      if (kept !== undefined) continue;
      db.prepare(
        `INSERT INTO investigation (id, encounter_id, test_name, ordered_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(newId(), encounterId, name, orderedDate, at, at);
    }
    recordAudit(db, {
      actor, action: 'investigations_ordered', entity: 'encounter', entityId: encounterId,
      details: { tests: clean },
    });
  });
  write();
}

/**
 * The signature.
 *
 * The whole text is copied into the audit entry as it stood at this
 * moment. If anybody ever amends it afterwards, what was signed is
 * still readable, in a table nothing can edit.
 */
export function confirmEncounter(db: Db, encounterId: string, actor: Actor, at: string = nowIso()): void {
  requireDoctor(actor, 'confirm a consultation');
  const row = loadOrFail(db, encounterId);
  if (row.confirmedAt !== null) return;

  const content = db.prepare(
    `SELECT chief_complaint AS chiefComplaint, examination_notes AS examinationNotes,
            working_diagnosis AS workingDiagnosis, decision_notes AS decisionNotes,
            follow_up_after_days AS followUpAfterDays
     FROM encounter WHERE id = ?`,
  ).get(encounterId) as Record<string, string | number | null>;

  const isBlank = Object.values(content).every((v) => v === null);
  const medicines = db.prepare(
    'SELECT count(*) AS n FROM medication WHERE encounter_id = ? AND deleted_at IS NULL',
  ).get(encounterId) as { n: number };
  // A consultation that wrote nothing but ordered three tests is not
  // an empty consultation. "Come back with these results" is a real
  // decision and the tests are the record of it.
  const tests = db.prepare(
    'SELECT count(*) AS n FROM investigation WHERE encounter_id = ? AND deleted_at IS NULL',
  ).get(encounterId) as { n: number };
  if (isBlank && medicines.n === 0 && tests.n === 0) {
    throw new EncounterError(
      'There is nothing written down to confirm.',
      'Write at least what the complaint was and what you decided. An empty confirmed consultation in a record is worse than no consultation at all, because it looks like one.',
    );
  }

  const write = db.transaction(() => {
    db.prepare('UPDATE encounter SET doctor_confirmed_by = ?, doctor_confirmed_at = ?, updated_at = ? WHERE id = ?')
      .run(actor.id, at, at, encounterId);
    recordAudit(db, {
      actor, action: 'encounter_confirmed', entity: 'encounter', entityId: encounterId,
      details: { visit_id: row.visitId, signed: content, medicines: medicines.n, tests: tests.n },
    });
  });
  write();
  recordUsage(db, { eventType: 'encounter_confirmed', actorId: actor.id, visitId: row.visitId, timestamp: at });
}

export function unconfirmEncounter(db: Db, encounterId: string, actor: Actor, reason: string | null = null, at: string = nowIso()): void {
  requireDoctor(actor, 'undo a confirmation');
  const row = loadOrFail(db, encounterId);
  if (row.confirmedAt === null) return;

  const write = db.transaction(() => {
    db.prepare('UPDATE encounter SET doctor_confirmed_by = NULL, doctor_confirmed_at = NULL, updated_at = ? WHERE id = ?')
      .run(at, encounterId);
    recordAudit(db, {
      actor, action: 'encounter_confirmation_undone', entity: 'encounter', entityId: encounterId,
      details: { was_confirmed_at: row.confirmedAt, reason: text(reason) },
    });
  });
  write();
}

export function encounterFor(db: Db, visitId: string): EncounterView | null {
  const row = db.prepare(
    `SELECT e.id, e.visit_id AS visitId, e.chief_complaint AS chiefComplaint,
            e.examination_notes AS examinationNotes, e.working_diagnosis AS workingDiagnosis,
            e.decision_notes AS decisionNotes, e.follow_up_after_days AS followUpAfterDays,
            e.doctor_confirmed_at AS confirmedAt, e.updated_at AS updatedAt,
            entered.display_name AS enteredByName, confirmed.display_name AS confirmedByName
     FROM encounter e
     LEFT JOIN app_user entered ON entered.id = e.entered_by
     LEFT JOIN app_user confirmed ON confirmed.id = e.doctor_confirmed_by
     WHERE e.visit_id = ? AND e.deleted_at IS NULL`,
  ).get(visitId) as Record<string, string | number | null> | undefined;
  if (row === undefined) return null;

  const encounterId = String(row.id);
  return {
    id: encounterId,
    visitId: String(row.visitId),
    chiefComplaint: row.chiefComplaint as string | null,
    examinationNotes: row.examinationNotes as string | null,
    workingDiagnosis: row.workingDiagnosis as string | null,
    decisionNotes: row.decisionNotes as string | null,
    followUpAfterDays: row.followUpAfterDays as number | null,
    confirmedAt: row.confirmedAt as string | null,
    confirmedByName: row.confirmedByName as string | null,
    enteredByName: row.enteredByName as string | null,
    updatedAt: String(row.updatedAt),
    medications: medicationsOf(db, encounterId),
    investigations: (db.prepare(
      `SELECT test_name AS testName FROM investigation
       WHERE encounter_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid`,
    ).all(encounterId) as Array<{ testName: string }>).map((r) => r.testName),
  };
}

export function medicationsOf(db: Db, encounterId: string): MedicationInput[] {
  return (db.prepare(
    `SELECT drug_name AS drugName, strength, dose, frequency, duration_days AS durationDays, instructions
     FROM medication WHERE encounter_id = ? AND deleted_at IS NULL ORDER BY sort_order, rowid`,
  ).all(encounterId) as Array<Record<string, string | number | null>>).map((r) => ({
    drugName: String(r.drugName),
    strength: r.strength as string | null,
    dose: r.dose as string | null,
    frequency: r.frequency as string | null,
    durationDays: r.durationDays as number | null,
    instructions: r.instructions as string | null,
  }));
}
