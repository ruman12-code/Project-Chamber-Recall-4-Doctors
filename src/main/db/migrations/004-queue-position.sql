-- Schema 4: the order the doctor sees people in, kept separate from the
-- number the patient was given.
--
-- These are two different things and conflating them is the mistake
-- this column exists to prevent:
--
--   serial_no       what the patient was TOLD. Spoken aloud, written on
--                   a slip, remembered. It never changes. A register
--                   that renumbers people is a register nobody trusts.
--
--   queue_position  who the doctor sees next. Starts equal to the
--                   serial, and can be changed when somebody needs to
--                   be seen sooner.
--
-- Usually they agree. When they do not, the patient still holds serial
-- 14 and still hears "fourteen" called out, and the screen still knows
-- to bring them in third.
ALTER TABLE visit ADD COLUMN queue_position INTEGER;

-- Everything already in the register keeps the order it already had.
UPDATE visit SET queue_position = serial_no WHERE queue_position IS NULL;

CREATE INDEX idx_visit_queue ON visit(chamber_id, visit_date, queue_position);
