-- Schema 17: the chamber's own logo.
--
-- The doctor opens the laptop and answers one question before anything
-- else: which room am I in. Two cards, and the difference between them
-- is currently a line of text. Tapping the wrong one means working the
-- wrong list, and the fastest thing a person recognises is not a word
-- but a mark they already know.
--
-- So a chamber can carry its own logo, and the card shows it.
--
-- Stored IN the database, as bytes, like the photographs of a patient's
-- paper. Not as a path to a file on the disk, which is the obvious
-- alternative and the wrong one: a path breaks the moment somebody
-- tidies their Pictures folder, and it would sit outside the encrypted
-- database and outside the backup that the whole pilot depends on. A
-- logo is small. It goes in the file with everything else.
ALTER TABLE chamber ADD COLUMN logo BLOB;
ALTER TABLE chamber ADD COLUMN logo_content_type TEXT
  CHECK (logo_content_type IS NULL OR logo_content_type IN ('image/png', 'image/jpeg', 'image/svg+xml'));
ALTER TABLE chamber ADD COLUMN logo_set_at TEXT;

-- Who put it there. Everything written in this program carries the name
-- of the person who wrote it, and a logo is no exception.
ALTER TABLE chamber ADD COLUMN logo_set_by TEXT REFERENCES app_user(id);
