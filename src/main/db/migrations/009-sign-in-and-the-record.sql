-- Schema 9: real people, and the record they write.
--
-- Until now nothing in this program knew who anybody was. Every action
-- was recorded against a placeholder user whose name says exactly that
-- ("Front desk (before sign-in was set up)"). That was honest while the
-- only data was practice data. It stops being acceptable the moment a
-- real patient is entered, because "who wrote this" is part of a
-- medical record and cannot be reconstructed afterwards.
--
-- The PIN columns have been in app_user since the beginning, unused.
-- They are used from here.
ALTER TABLE app_user ADD COLUMN pin_set_at TEXT;
ALTER TABLE app_user ADD COLUMN last_signed_in_at TEXT;

-- ==================================================================
-- A confirmed encounter cannot be quietly edited.
-- ==================================================================
-- Confirming is the doctor saying "this is what happened in this
-- consultation". After that, changing a word of it without a trace is
-- exactly what a medical record must not allow: it is the difference
-- between an amended record and a falsified one.
--
-- Changing a confirmed encounter is still possible, and sometimes
-- necessary. It takes two steps: undo the confirmation, which is
-- recorded, then change it, then confirm again. The audit log ends up
-- holding the whole sequence.
--
-- Note what this trigger deliberately allows: setting doctor_confirmed_at
-- to NULL (undoing), and touching updated_at. It only refuses a change
-- to the clinical text of a record that is currently signed.
CREATE TRIGGER encounter_confirmed_is_locked
BEFORE UPDATE ON encounter
WHEN OLD.doctor_confirmed_at IS NOT NULL AND NEW.doctor_confirmed_at IS NOT NULL
 AND (IFNULL(NEW.chief_complaint, '')      <> IFNULL(OLD.chief_complaint, '')
   OR IFNULL(NEW.examination_notes, '')    <> IFNULL(OLD.examination_notes, '')
   OR IFNULL(NEW.working_diagnosis, '')    <> IFNULL(OLD.working_diagnosis, '')
   OR IFNULL(NEW.decision_notes, '')       <> IFNULL(OLD.decision_notes, '')
   OR IFNULL(NEW.follow_up_after_days, -1) <> IFNULL(OLD.follow_up_after_days, -1))
BEGIN
  SELECT RAISE(ABORT, 'this encounter is confirmed: undo the confirmation before changing it');
END;

-- The prescription is part of the same signed record, so it is locked
-- with it. Removing a medicine is a soft delete, which is an UPDATE,
-- so that is caught by the same rule.
CREATE TRIGGER medication_of_confirmed_encounter_no_insert
BEFORE INSERT ON medication
WHEN (SELECT doctor_confirmed_at FROM encounter WHERE id = NEW.encounter_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'this encounter is confirmed: undo the confirmation before changing the prescription');
END;

CREATE TRIGGER medication_of_confirmed_encounter_no_update
BEFORE UPDATE ON medication
WHEN (SELECT doctor_confirmed_at FROM encounter WHERE id = NEW.encounter_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'this encounter is confirmed: undo the confirmation before changing the prescription');
END;

-- Investigations are different, and the difference matters.
--
-- WHICH tests were ordered is part of the signed record and is locked
-- with it. The RESULT comes back days or weeks later, long after the
-- encounter was confirmed, and recording it must never require undoing
-- a signature on a consultation that is finished. So the result
-- columns stay open for ever and everything else is frozen.
CREATE TRIGGER investigation_of_confirmed_encounter_no_insert
BEFORE INSERT ON investigation
WHEN (SELECT doctor_confirmed_at FROM encounter WHERE id = NEW.encounter_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'this encounter is confirmed: undo the confirmation before adding a test to it');
END;

CREATE TRIGGER investigation_of_confirmed_encounter_only_results_may_change
BEFORE UPDATE ON investigation
WHEN (SELECT doctor_confirmed_at FROM encounter WHERE id = NEW.encounter_id) IS NOT NULL
 AND (NEW.test_name <> OLD.test_name
   OR NEW.ordered_date <> OLD.ordered_date
   OR NEW.encounter_id <> OLD.encounter_id
   OR IFNULL(NEW.deleted_at, '') <> IFNULL(OLD.deleted_at, ''))
BEGIN
  SELECT RAISE(ABORT, 'this encounter is confirmed: only the result of a test may be recorded, not the test itself');
END;
