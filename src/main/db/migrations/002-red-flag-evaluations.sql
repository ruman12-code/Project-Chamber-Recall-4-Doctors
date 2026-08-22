-- Schema 2: record EVERY red flag rule evaluation, not only the ones
-- that fired.
--
-- The brief asks for this explicitly, and the reason is worth stating:
-- to explain months later why a patient was NOT moved up the queue, it
-- is not enough to know that no alert fired. You need to know which
-- rules ran, in which version, and what they decided. Without this
-- table a non-escalation is invisible and unexplainable.
--
-- outcome is one of:
--   fired            the rule matched and the assistant was alerted
--   did_not_fire     the rule ran and did not match
--   could_not_check  the rule needed an answer the patient did not give
--
-- could_not_check exists because a skipped question must never quietly
-- act like a "no". When any rule lands here, the doctor's screen says
-- the screening was incomplete and names the missing questions.

CREATE TABLE red_flag_evaluation (
  id                TEXT PRIMARY KEY,
  intake_id         TEXT NOT NULL REFERENCES intake(id),
  rule_id           TEXT NOT NULL,
  rule_version      TEXT NOT NULL,
  -- Fingerprint of the whole rules file as it stood at that moment, so
  -- the exact rulebook can be identified even if a rule's version
  -- number was not increased when it should have been.
  rulebook_checksum TEXT NOT NULL,
  evaluated_at      TEXT NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('fired', 'did_not_fire', 'could_not_check')),
  -- Comma-separated question keys the rule needed and did not have.
  unknown_questions TEXT
);

CREATE INDEX idx_rf_eval_intake  ON red_flag_evaluation(intake_id);
CREATE INDEX idx_rf_eval_outcome ON red_flag_evaluation(outcome, evaluated_at);

-- This is a log of clinical screening decisions. Like the audit log, it
-- can only be added to.
CREATE TRIGGER rf_eval_is_append_only_no_update
BEFORE UPDATE ON red_flag_evaluation
BEGIN
  SELECT RAISE(ABORT, 'red_flag_evaluation is append-only: rows can never be changed');
END;

CREATE TRIGGER rf_eval_is_append_only_no_delete
BEFORE DELETE ON red_flag_evaluation
BEGIN
  SELECT RAISE(ABORT, 'red_flag_evaluation is append-only: rows can never be deleted');
END;
