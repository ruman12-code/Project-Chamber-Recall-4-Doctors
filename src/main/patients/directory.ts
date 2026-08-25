// ===================================================================
// The directory: every patient's name and phone number, and nothing
// else, so the front desk can tell a returning patient from a new one
// with no laptop in the room.
// ===================================================================
// This is the one place in the program where patient-identifying data
// leaves the encrypted database and lands on a tablet, and it was
// decided deliberately after the cost was put in writing. What it buys
// is the two hours before the doctor arrives: without it the desk
// cannot tell whether the woman at the counter has been here before,
// and every returning patient becomes a duplicate record.
//
// WHAT GOES, AND WHAT NEVER GOES
//
// Name, phone number, the DATE they were last seen, and which chamber
// they were last seen at. Not age, not sex, not address, not one
// answer, not one word a doctor ever wrote.
//
// The last visit was added deliberately, after the first version went
// without it. Without it the desk cannot tell a genuinely new patient
// from one whose history the tablet simply cannot see, and the screen
// ends up either silent or -- worse -- saying "no previous visit" about
// somebody who has been coming for years.
//
// A tablet that is lost is a list of names, numbers and dates. That is
// bad, and is a notifiable thing under the Personal Data Protection
// Act, and is still a world away from a history.
//
// EVERY PATIENT, NOT EVERY PATIENT OF THIS CHAMBER
//
// A woman seen at Lubana in March walks into Popular in August. She is
// the same woman and the same record. The desk at Popular must find her
// -- otherwise it registers her again and the doctor opens a card with
// half her history on it. So this is the whole register, and the
// chamber she was last seen at is on it so the assistant can say "yes,
// you came to the other one" out loud.
//
// The rows carry the SEARCHABLE forms as well, because the tablet has
// to match a typed number the way the laptop does. Two implementations
// of "is this the same phone number" would drift apart, and the day
// they drifted the desk would be told a returning patient was new.
import type { Db } from '../db/open';

export interface DirectoryEntry {
  id: string;
  nameBn: string | null;
  nameEn: string | null;
  phone: string | null;
  /** The last time they were seen ANYWHERE, and where. Null for
   *  somebody registered but never yet seen. */
  lastVisitDate: string | null;
  lastChamberName: string | null;
  /** Normalised copies, so the tablet matches exactly as the laptop does. */
  sBn: string | null;
  sEn: string | null;
  sPhone: string | null;
}

export interface Directory {
  takenAt: string;
  entries: DirectoryEntry[];
}

/**
 * Everybody who could walk back in. Merged-away records are left out:
 * the desk should find the record that survived, not the one that was
 * folded into it.
 */
export function buildDirectory(db: Db, takenAt: string): Directory {
  const entries = db.prepare(
    `SELECT p.id, p.full_name_bn AS nameBn, p.full_name_en AS nameEn, p.phone,
            p.search_name_bn AS sBn, p.search_name_en AS sEn, p.search_phone AS sPhone,
            (SELECT max(v.visit_date) FROM visit v
              WHERE v.patient_id = p.id AND v.deleted_at IS NULL) AS lastVisitDate,
            (SELECT c.name FROM visit v JOIN chamber c ON c.id = v.chamber_id
              WHERE v.patient_id = p.id AND v.deleted_at IS NULL
              ORDER BY v.visit_date DESC LIMIT 1) AS lastChamberName
       FROM patient p
      WHERE p.deleted_at IS NULL AND p.merged_into_patient_id IS NULL
      ORDER BY p.rowid`,
  ).all() as DirectoryEntry[];
  return { takenAt, entries };
}
