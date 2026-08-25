-- Schema 13: the patient who came only to show a test report.
--
-- A large share of an evening is people the doctor sent for a test last
-- time, coming back with the paper. They have no new complaint. Asking
-- them "what is troubling you today, and for how long" is asking the
-- wrong question, and the answers pollute the record: a screening full
-- of "nothing" is indistinguishable from a screening nobody took.
--
-- So the desk marks it, once, at the top of the intake, and the
-- questions that follow are skipped for that patient. What the doctor
-- gets is the truth: this person is here to show you what you asked
-- for.
--
-- WHAT THIS IS NOT
--
-- It is not a lighter kind of patient and it does not change their
-- place in the queue. The red flag rules still run on whatever IS
-- recorded, and somebody who says something alarming while handing over
-- a report is still moved up. Nobody is ever moved DOWN for being here
-- about a report -- the ordering of today's list is untouched by this
-- migration, and stays that way until a doctor says otherwise.
--
-- 'consultation' is every visit that has ever existed, so no row needs
-- backfilling and no existing behaviour changes.
ALTER TABLE visit ADD COLUMN visit_kind TEXT NOT NULL DEFAULT 'consultation'
  CHECK (visit_kind IN ('consultation', 'reports_only'));

-- Which visit the reports were asked for at, when the desk knows. Null
-- when nobody could say. Not used to decide anything; it is there so the
-- doctor opening the card knows which consultation to look back at.
ALTER TABLE visit ADD COLUMN reports_for_visit_id TEXT REFERENCES visit(id);
