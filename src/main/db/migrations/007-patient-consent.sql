-- Schema 7: consent, recorded per patient and never overwritten.
--
-- WHY THIS IS PER PATIENT AND NOT PER VISIT
--
-- The original data model put consent on the intake, which meant asking
-- the same person again every single visit - eight times over four
-- years for a regular patient. That is not better consent, it is a
-- ritual that both sides learn to tap through.
--
-- Consent is therefore recorded once per patient, against a VERSION of
-- the wording. If the wording changes, the version changes, and the
-- patient is asked once more. Each visit records which consent was in
-- force when it happened, so any record can be traced back to the exact
-- words the patient agreed to.
--
-- WHY EVERY DECISION IS A NEW ROW
--
-- Consent can be given, declined, and withdrawn, and the law of
-- Bangladesh gives a person the right to withdraw at any time. What
-- matters afterwards is not only what the current state is but when it
-- changed and who recorded it. So this table is append-only: the
-- current position is the latest row for that patient and kind, and the
-- history above it stays exactly as it was written.
CREATE TABLE patient_consent (
  id            TEXT PRIMARY KEY,
  patient_id    TEXT NOT NULL REFERENCES patient(id),
  -- care_record: keeping a history for this doctor's own use.
  -- research:    anonymised use, asked and answered entirely separately.
  kind          TEXT NOT NULL CHECK (kind IN ('care_record', 'research')),
  -- The version of the wording that was actually read out or shown.
  version       TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN ('given', 'declined', 'withdrawn')),
  decided_at    TEXT NOT NULL,
  recorded_by   TEXT NOT NULL REFERENCES app_user(id),
  -- Who actually agreed. Plenty of patients arrive with a son or a
  -- daughter-in-law who does the talking, and a record that quietly
  -- treats that as the patient's own consent is a record that lies.
  given_by      TEXT NOT NULL DEFAULT 'self' CHECK (given_by IN ('self', 'guardian', 'family_member', 'other')),
  given_by_name TEXT,
  relationship  TEXT,
  -- How the patient was actually told: the recording, or the assistant
  -- reading it aloud. Consent from someone who could not read a screen
  -- and was never read to is not informed consent, and the pilot report
  -- needs to be able to see how often each happened.
  method        TEXT NOT NULL CHECK (method IN ('audio', 'read_aloud', 'screen_only')),
  language      TEXT NOT NULL CHECK (language IN ('bn', 'en')),
  notes         TEXT
);

CREATE INDEX idx_consent_patient ON patient_consent(patient_id, kind, decided_at DESC);

CREATE TRIGGER patient_consent_is_append_only_no_update
BEFORE UPDATE ON patient_consent
BEGIN
  SELECT RAISE(ABORT, 'patient_consent is append-only: record a new decision instead of changing an old one');
END;

CREATE TRIGGER patient_consent_is_append_only_no_delete
BEFORE DELETE ON patient_consent
BEGIN
  SELECT RAISE(ABORT, 'patient_consent is append-only: a consent decision is never deleted');
END;
