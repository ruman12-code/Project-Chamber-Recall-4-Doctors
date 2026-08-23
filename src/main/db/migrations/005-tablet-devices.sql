-- Schema 5: which tablets are allowed to talk to the laptop.
--
-- The tablet reaches the laptop over the chamber's wifi. Anything else
-- on that wifi can reach it too - a patient's phone, a neighbour's
-- laptop, whatever the building shares. Without this table the intake
-- questions, the waiting list and every patient's name would be
-- readable by any device on the network.
--
-- Pairing is once per tablet: the laptop shows a short code, the tablet
-- is given it, and from then on the tablet holds a long random token.
-- Only a hash of that token is stored here, so this table by itself
-- cannot be used to impersonate a tablet.
CREATE TABLE tablet_device (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  paired_at    TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX idx_tablet_token ON tablet_device(token_hash);

CREATE TRIGGER tablet_device_no_hard_delete
BEFORE DELETE ON tablet_device
BEGIN
  SELECT RAISE(ABORT, 'tablet_device rows are never deleted: set revoked_at instead');
END;
