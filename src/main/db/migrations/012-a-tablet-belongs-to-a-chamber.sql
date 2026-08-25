-- Schema 12: a tablet belongs to one chamber, and can work without the
-- laptop in the room.
--
-- THE PROBLEM THIS SOLVES
--
-- The doctor holds two chambers on the same evening. Patients arrive at
-- Popular while he is still at Lubana, and the laptop is with him. Until
-- now the tablet could ask questions with the wifi down, but it could
-- not search for a patient, register one, or give out a serial number,
-- because all three needed the laptop. So the two hours before the
-- doctor arrives -- exactly the time the front desk has free -- were
-- unusable.
--
-- WHAT CHANGED, AND WHAT DID NOT
--
-- The old code said, in the route that gives out serials:
--
--   "A serial number has to be unique and in order for the whole
--    chamber, and two tablets handing out number 14 from their own
--    buffers would be worse than a tablet that says plainly it cannot
--    reach the laptop."
--
-- That is still true. What makes it safe now is the column added here:
-- a tablet is bound to ONE chamber when it is paired, and exactly one
-- tablet gives out serials for that chamber. Two tablets handing out
-- number 14 cannot happen because there are not two tablets at one
-- desk.
--
-- The residual case is real and is handled loudly rather than quietly:
-- the LAPTOP can also give out a serial for that chamber while the
-- tablet is offline with arrivals not yet sent. When those arrive and
-- the number is taken, the patient keeps their place in the order,
-- takes the next free number, and the laptop says so on today's list
-- until somebody acknowledges it. A patient who was told "seven" and
-- is now twelve must be told again by a person.
ALTER TABLE tablet_device ADD COLUMN chamber_id TEXT REFERENCES chamber(id);

-- ==================================================================
-- A serial that was given out at the desk before the laptop saw it.
-- ==================================================================
-- Set when an arrival made offline could not keep the number the desk
-- announced. Null for every ordinary arrival, which is nearly all of
-- them. It is cleared when somebody says they have told the patient.
ALTER TABLE visit ADD COLUMN serial_announced INTEGER;
ALTER TABLE visit ADD COLUMN serial_clash_seen_at TEXT;

-- What the tablet called this arrival before the laptop had ever heard
-- of it. The tablet sends the same id if it has to send twice, which is
-- what makes an arrival safe to retry: the second one changes nothing.
ALTER TABLE visit ADD COLUMN desk_ref TEXT;
CREATE UNIQUE INDEX visit_desk_ref_unique ON visit(desk_ref) WHERE desk_ref IS NOT NULL;

-- The same, for a patient registered at the desk with no laptop to give
-- out an id. Without this, a registration sent twice makes two people.
ALTER TABLE patient ADD COLUMN desk_ref TEXT;
CREATE UNIQUE INDEX patient_desk_ref_unique ON patient(desk_ref) WHERE desk_ref IS NOT NULL;
