-- Schema 8: the doctor accepting, or correcting, what the front desk
-- wrote down.
--
-- Until this happens, what a patient told an assistant at a desk is
-- NOT part of the clinical record. It is a report of what was said,
-- and the Recall Card labels it as one. This is the moment a doctor
-- reads it and either accepts it or puts it right.
--
-- Note that this is a different event from confirming an ENCOUNTER,
-- which is the doctor signing off his own notes at the end of the
-- consultation and lives on the encounter table. They happen minutes
-- apart and mean different things:
--
--   intake confirmed     "what the patient told my assistant is right"
--   encounter confirmed  "what I wrote about this consultation is right"
--
-- Conflating them would let one tap at the start of a consultation
-- sign off notes that had not been written yet.
ALTER TABLE intake ADD COLUMN doctor_confirmed_by TEXT REFERENCES app_user(id);
ALTER TABLE intake ADD COLUMN doctor_confirmed_at TEXT;

-- A correction never overwrites what the patient said.
--
-- The front desk answer stays exactly as it was recorded, because it
-- is evidence of what the patient actually said to somebody. The
-- doctor's correction sits alongside it. Both are visible, and which
-- is which is never in doubt.
--
-- Append-only, so a second correction does not erase the first.
CREATE TABLE intake_correction (
  id                  TEXT PRIMARY KEY,
  intake_id           TEXT NOT NULL REFERENCES intake(id),
  question_key        TEXT NOT NULL,
  corrected_value     TEXT,
  corrected_free_text TEXT,
  -- The doctor saying the answer is simply wrong, rather than offering
  -- a different one. "The patient did not say that."
  marked_wrong        INTEGER NOT NULL DEFAULT 0 CHECK (marked_wrong IN (0, 1)),
  corrected_by        TEXT NOT NULL REFERENCES app_user(id),
  corrected_at        TEXT NOT NULL,
  note                TEXT
);

CREATE INDEX idx_correction_intake ON intake_correction(intake_id, question_key, corrected_at);

CREATE TRIGGER intake_correction_is_append_only_no_update
BEFORE UPDATE ON intake_correction
BEGIN
  SELECT RAISE(ABORT, 'intake_correction is append-only: record another correction instead of changing one');
END;

CREATE TRIGGER intake_correction_is_append_only_no_delete
BEFORE DELETE ON intake_correction
BEGIN
  SELECT RAISE(ABORT, 'intake_correction is append-only: a correction is never deleted');
END;
