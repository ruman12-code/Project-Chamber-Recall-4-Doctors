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
// Name and phone number. Not age, not sex, not address, not one visit
// date, not one answer, not one word a doctor ever wrote. A tablet that
// is lost is a list of names and numbers -- which is bad, and is a
// notifiable thing under the Personal Data Protection Act, and is a
// world away from a history.
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
    `SELECT id, full_name_bn AS nameBn, full_name_en AS nameEn, phone,
            search_name_bn AS sBn, search_name_en AS sEn, search_phone AS sPhone
       FROM patient
      WHERE deleted_at IS NULL AND merged_into_patient_id IS NULL
      ORDER BY rowid`,
  ).all() as DirectoryEntry[];
  return { takenAt, entries };
}
