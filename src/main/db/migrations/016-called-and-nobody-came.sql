-- Schema 16: the number was called out and nobody stood up.
--
-- The doctor finishes with a patient, the tablet shows the next serial
-- across the whole screen, and the assistant calls it out. Sometimes
-- nobody comes: they are outside on the phone, or in the toilet, or
-- they gave up an hour ago and went home without telling anybody.
--
-- The desk needs to move on. What it must NOT do is take that patient
-- out of the queue, move them down it, or mark them as gone -- the desk
-- knows nobody answered, which is not the same as knowing they left,
-- and this system only ever moves people UP.
--
-- So nothing about the visit changes. Not its status, not its position,
-- not its serial. The patient stays exactly where they are on the
-- doctor's list. All that happens is this: a row is written here saying
-- the number was called at this time by this person and nobody came.
--
-- Two things fall out of that, and both are the point:
--
--   The desk moves on, because the tablet shows whoever has been called
--   the fewest times. Everybody gets called again before anybody gets
--   called a third time, so nobody is dropped by being unlucky once.
--
--   The doctor can see it. "Called twice, no answer" beside serial 7
--   tells him something a status of 'waiting' never could, and it is
--   his decision what to do about it -- not the tablet's.
CREATE TABLE call_no_answer (
  id         TEXT PRIMARY KEY,
  visit_id   TEXT NOT NULL REFERENCES visit(id),
  -- Made up by the tablet, unique here. The outbox may send the same
  -- one twice when a reply is lost; the second one finds the first and
  -- changes nothing, rather than inventing a call that never happened.
  desk_ref   TEXT NOT NULL UNIQUE,
  -- When the assistant actually called the number out, not when this
  -- reached the laptop.
  called_at  TEXT NOT NULL,
  -- The person who called it. Never optional: this is a record of
  -- somebody doing something, and it carries their name like the rest.
  called_by  TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_call_no_answer_visit ON call_no_answer(visit_id);
