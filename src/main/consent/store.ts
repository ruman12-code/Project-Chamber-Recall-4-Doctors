// ===================================================================
// Recording what a patient agreed to.
// ===================================================================
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso } from '../db/clock';
import { recordAudit, type Actor } from '../db/audit';
import { ChamberRecallError } from '../../shared/errors';
import type { ConsentKind } from './config';

export class ConsentRefusedError extends ChamberRecallError {}

export type ConsentDecision = 'given' | 'declined' | 'withdrawn';
export type ConsentGivenBy = 'self' | 'guardian' | 'family_member' | 'other';
export type ConsentMethod = 'audio' | 'read_aloud' | 'screen_only';

export interface ConsentRecordInput {
  patientId: string;
  kind: ConsentKind;
  version: string;
  decision: ConsentDecision;
  givenBy?: ConsentGivenBy;
  givenByName?: string | null;
  relationship?: string | null;
  method: ConsentMethod;
  language: 'bn' | 'en';
  notes?: string | null;
}

export interface ConsentRow {
  id: string;
  kind: ConsentKind;
  version: string;
  decision: ConsentDecision;
  decidedAt: string;
  recordedByName: string | null;
  givenBy: ConsentGivenBy;
  givenByName: string | null;
  relationship: string | null;
  method: ConsentMethod;
  language: 'bn' | 'en';
}

/**
 * Consent is answered per patient, so the same person is not asked
 * again every visit. It IS asked again when the wording changes, which
 * is what the version is for.
 */
export type ConsentStanding =
  | 'given'          // agreed, against the wording in use now
  | 'declined'       // said no, against the wording in use now
  | 'withdrawn'      // agreed once and has since changed their mind
  | 'not_asked'      // never been asked
  | 'out_of_date';   // answered an older version, so must be asked again

export interface ConsentState {
  careRecord: ConsentStanding;
  research: ConsentStanding;
  /** The most recent decision for each, whatever version it was against. */
  latest: { careRecord: ConsentRow | null; research: ConsentRow | null };
}

export function recordConsent(db: Db, input: ConsentRecordInput, actor: Actor, at: string = nowIso()): string {
  if (actor.id === null) {
    throw new ConsentRefusedError(
      'Consent cannot be recorded without knowing who recorded it.',
      'This is a fault in the software rather than anything you did. Report it before carrying on.',
    );
  }
  if (input.version.trim() === '') {
    throw new ConsentRefusedError(
      'Consent cannot be recorded without the version of the wording used.',
      'The consent wording has no version. Fix consent.yaml before taking any more histories.',
    );
  }
  const patient = db.prepare('SELECT id FROM patient WHERE id = ? AND deleted_at IS NULL').get(input.patientId);
  if (patient === undefined) {
    throw new ConsentRefusedError('That patient record no longer exists.', 'Search for the patient again.');
  }

  const id = newId();
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO patient_consent (id, patient_id, kind, version, decision, decided_at, recorded_by,
         given_by, given_by_name, relationship, method, language, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.patientId, input.kind, input.version.trim(), input.decision, at, actor.id,
      input.givenBy ?? 'self', input.givenByName ?? null, input.relationship ?? null,
      input.method, input.language, input.notes ?? null);

    recordAudit(db, {
      actor,
      action: `consent_${input.decision}`,
      entity: 'patient_consent',
      entityId: id,
      details: {
        patient_id: input.patientId, kind: input.kind, version: input.version.trim(),
        given_by: input.givenBy ?? 'self', method: input.method, language: input.language,
      },
    });
  });
  write();
  return id;
}

function latestFor(db: Db, patientId: string, kind: ConsentKind): ConsentRow | null {
  const row = db.prepare(
    `SELECT c.id, c.kind, c.version, c.decision, c.decided_at AS decidedAt,
            u.display_name AS recordedByName, c.given_by AS givenBy, c.given_by_name AS givenByName,
            c.relationship, c.method, c.language
     FROM patient_consent c LEFT JOIN app_user u ON u.id = c.recorded_by
     WHERE c.patient_id = ? AND c.kind = ?
     ORDER BY c.decided_at DESC, c.rowid DESC LIMIT 1`,
  ).get(patientId, kind) as ConsentRow | undefined;
  return row ?? null;
}

function standing(row: ConsentRow | null, currentVersion: string): ConsentStanding {
  if (row === null) return 'not_asked';
  if (row.decision === 'withdrawn') return 'withdrawn';
  // A decision against older wording is not a decision about the
  // wording being used now, so the patient has to be asked again.
  if (row.version !== currentVersion) return 'out_of_date';
  return row.decision === 'given' ? 'given' : 'declined';
}

export function consentState(db: Db, patientId: string, currentVersion: string): ConsentState {
  const careRecord = latestFor(db, patientId, 'care_record');
  const research = latestFor(db, patientId, 'research');
  return {
    careRecord: standing(careRecord, currentVersion),
    research: standing(research, currentVersion),
    latest: { careRecord, research },
  };
}

/**
 * A patient changing their mind.
 *
 * The law of Bangladesh gives them this right at any time, and once it
 * is exercised the processing has to stop. What that means in practice
 * differs between the two permissions, and pretending otherwise would
 * be worse than saying it plainly:
 *
 *   research      stops completely and at once. Nothing withdrawn is
 *                 ever included in an anonymised export again.
 *
 *   care_record   stops anything NEW being recorded. What is already
 *                 in the record is a medical record, and destroying it
 *                 is the doctor's decision to make and to document -
 *                 not something an assistant does with one tap at a
 *                 front desk. The request is recorded here so the
 *                 doctor can see it and act on it.
 */
export function withdrawConsent(
  db: Db, patientId: string, kind: ConsentKind, actor: Actor, notes: string | null = null, at: string = nowIso(),
): void {
  const latest = latestFor(db, patientId, kind);
  if (latest === null) {
    throw new ConsentRefusedError(
      'This patient has never been asked for that permission, so there is nothing to withdraw.',
      'Check you have the right patient.',
    );
  }
  if (latest.decision === 'withdrawn') return;

  recordConsent(db, {
    patientId, kind, version: latest.version, decision: 'withdrawn',
    givenBy: latest.givenBy, givenByName: latest.givenByName, relationship: latest.relationship,
    method: latest.method, language: latest.language, notes,
  }, actor, at);
}

/**
 * The patients whose information may go into an anonymised export.
 *
 * Deliberately a list of who said YES, rather than a list of who to
 * leave out. A mistake in an opt-out list quietly includes somebody who
 * refused; the same mistake here quietly leaves out somebody who agreed,
 * which harms nobody.
 */
export function patientsConsentingToResearch(db: Db, currentVersion: string): string[] {
  return (db.prepare(
    `SELECT patient_id AS id FROM patient_consent c
     WHERE c.kind = 'research' AND c.version = ?
       AND c.decision = 'given'
       AND c.decided_at = (SELECT max(c2.decided_at) FROM patient_consent c2
                            WHERE c2.patient_id = c.patient_id AND c2.kind = 'research')
       AND NOT EXISTS (SELECT 1 FROM patient_consent c3
                        WHERE c3.patient_id = c.patient_id AND c3.kind = 'research'
                          AND c3.decision = 'withdrawn')`,
  ).all(currentVersion) as Array<{ id: string }>).map((r) => r.id);
}
