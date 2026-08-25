-- Schema 14: the patient who has been coming for eight years.
--
-- On the first evening this program runs, every patient is new to it.
-- The register is empty and the software will say "first visit" against
-- a woman the doctor has been treating since 2019.
--
-- That is not a cosmetic problem. "First visit" is a clinical statement:
-- it tells the doctor there is no history to look for and tells the desk
-- to take a full set of details. Printed against somebody with a plastic
-- bag full of old prescriptions, it is simply false, and it stays false
-- for as long as it takes that patient to accumulate visits here.
--
-- WHAT THIS IS NOT
--
-- It is not a back-fill. Typing four years of paper into the database
-- before launch would take weeks, put transcription errors into a
-- clinical record, and cover data nobody has consented to. The paper
-- stays paper; it gets photographed when they bring it.
--
-- This is one fact, asked once, in the patient's own words: how long
-- have you been coming to this doctor. It changes nothing the program
-- decides. It stops one sentence being a lie.
ALTER TABLE patient ADD COLUMN attending_since TEXT;

-- Where that came from. 'patient' is what they said at the desk, which
-- is the usual case and is an estimate. 'doctor' is the doctor
-- correcting it from his own memory of them, which beats the estimate.
ALTER TABLE patient ADD COLUMN attending_since_source TEXT
  CHECK (attending_since_source IS NULL OR attending_since_source IN ('patient', 'doctor'));
