-- Schema 3: a normalised copy of the phone number, for searching.
--
-- The same handset gets written down a dozen ways at a front desk:
--   01712345678   01712-345678   +8801712345678   0171 234 5678
-- All of those are one phone, and an assistant who types any of them
-- while a patient stands waiting must find the record.
--
-- The raw phone column keeps exactly what was typed, because that is
-- what the patient said and it is what gets dialled. This column holds
-- the digits reduced to a single canonical form, and is the only one
-- searched against.
ALTER TABLE patient ADD COLUMN search_phone TEXT;
CREATE INDEX idx_patient_search_phone ON patient(search_phone);
