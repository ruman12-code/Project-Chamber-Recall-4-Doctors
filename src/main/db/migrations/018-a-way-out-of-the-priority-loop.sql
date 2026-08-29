-- Schema 18: the desk has to be able to move on.
--
-- A patient a screening rule flagged is never called after one it did
-- not. That is the whole point of the flag and it is not negotiable.
--
-- But it has a consequence nobody thought through until a real desk hit
-- it: if the flagged patients are not in the room, the calling order
-- cannot get past them. The tablet offers "nobody came", the desk taps
-- it, and the same small group of numbers comes round again and again
-- while a waiting room full of other people is never called.
--
-- WHAT THIS IS, AND WHAT IT IS CAREFUL NOT TO BE
--
-- It is a PERSON deciding, once, per patient, that this flagged patient
-- is not here right now and the desk will call somebody else. It is
-- recorded with their name and the time, like everything else.
--
-- It is NOT the software de-escalating anybody. Nothing about the visit
-- changes: not its status, not its queue position, not its serial, and
-- not its flag. The patient keeps SEE SOONER on the doctor's list, keeps
-- their place in it, and the doctor can call them in at any moment. The
-- ONLY thing this changes is which number the front desk shouts next.
--
-- And the doctor is told. A patient who has been passed over is marked
-- as such on his list, so the one clinical judgement in all of this --
-- whether somebody flagged who is not answering should be chased, waited
-- for, or seen late -- is made by him, with the fact in front of him.
CREATE TABLE priority_bypass (
  id         TEXT PRIMARY KEY,
  visit_id   TEXT NOT NULL REFERENCES visit(id),
  -- Made up by the tablet, so the same tap sent twice is one decision.
  desk_ref   TEXT NOT NULL UNIQUE,
  -- When the person decided, not when it reached the laptop.
  decided_at TEXT NOT NULL,
  -- Who decided. Never optional.
  decided_by TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_priority_bypass_visit ON priority_bypass(visit_id);
