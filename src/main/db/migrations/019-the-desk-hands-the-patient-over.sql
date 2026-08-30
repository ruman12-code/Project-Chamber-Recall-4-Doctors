-- ===================================================================
-- The desk hands a patient over to the chamber.
-- ===================================================================
-- Until now the doctor pressed "Call in" for every patient, and the
-- tablet's "I have sent them in" changed nothing anywhere -- it only
-- closed the card. The two screens each knew half of what had just
-- happened in the corridor.
--
-- This is the other half, written down: a named person at the desk
-- says a named patient has been sent into the room. It is a REQUEST,
-- not a status change. The laptop shows it to whoever is at the
-- chamber and they accept it; only then does the patient become
-- in_chamber. Nobody at a desk in another room can put a patient in
-- front of the doctor without the doctor agreeing.
--
-- Both answers are kept. An accepted hand-off says who accepted it and
-- when; a declined one says the same, and the patient stays exactly
-- where they were, still waiting, still with their serial. Nothing
-- here is ever deleted or overwritten -- a second hand-off for the
-- same patient is a second row.
--
-- desk_ref is the tablet's own reference for the tap. It is UNIQUE so
-- that an outbox re-sending after a wifi drop makes one hand-off and
-- not two.
CREATE TABLE desk_handoff (
  id          TEXT PRIMARY KEY,
  visit_id    TEXT NOT NULL REFERENCES visit(id),
  desk_ref    TEXT NOT NULL UNIQUE,
  -- 'ordinary' is the desk working down the calling order. 'priority'
  -- is a person at the desk deciding this patient goes in NOW, which
  -- is the manual intervention a flagged patient gets. The doctor sees
  -- which it was before accepting.
  reason      TEXT NOT NULL DEFAULT 'ordinary',
  sent_at     TEXT NOT NULL,
  sent_by     TEXT NOT NULL REFERENCES app_user(id),
  -- Null until somebody at the chamber answers. 'accepted' or
  -- 'declined'; never back to null.
  decision    TEXT,
  decided_at  TEXT,
  decided_by  TEXT REFERENCES app_user(id),
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_desk_handoff_visit ON desk_handoff(visit_id);
-- The laptop asks "is anything waiting for me" every few seconds.
CREATE INDEX idx_desk_handoff_open ON desk_handoff(decision, sent_at);
