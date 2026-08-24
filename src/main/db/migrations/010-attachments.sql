-- Schema 10: photographs of paper.
--
-- Patients in a Bangladeshi chamber carry their history in a plastic
-- bag: lab reports, old prescriptions, discharge summaries, a folder
-- from another doctor. That paper is often the only record of what
-- happened to them, and the moment they walk out it is gone again.
-- Photographing it at the desk is the cheapest way this system ever
-- gets a real history.
--
-- WHY THE IMAGE LIVES IN THE DATABASE RATHER THAN BESIDE IT
--
-- The original design had a file_path column, meaning the picture sat
-- as a file in the data folder. That was wrong for two reasons.
--
--   1. It would not be encrypted. The database is SQLCipher; a JPEG
--      next to it is not. A photograph of a lab report has the
--      patient's name across the top and their results underneath,
--      and leaving that readable to anybody holding the laptop would
--      undo the whole point of encrypting the records.
--
--   2. A row and a file can come apart. A crash between the two
--      writes, a half-finished copy to a new laptop, somebody tidying
--      the folder - each leaves a record pointing at nothing, or a
--      picture belonging to nobody. Inside the database they are one
--      write in one transaction and cannot separate.
--
-- The cost is size. A downscaled photograph is around 300 KB, so this
-- chamber will add roughly 100 MB over the twelve-week pilot and a few
-- gigabytes over years. SQLite carries that without complaint, and a
-- backup stays what it should be: copy one folder. If a much busier
-- practice ever makes the file too heavy to copy, moving the blobs out
-- to separately encrypted files is a contained change - but it is not
-- a problem this chamber has, and building for it now would be
-- guessing.
--
-- The table is rebuilt rather than altered because it has never held a
-- row: attachments are the thing being built here.
DROP TABLE attachment;

CREATE TABLE attachment (
  id           TEXT PRIMARY KEY,
  patient_id   TEXT NOT NULL REFERENCES patient(id),
  -- Which visit it was captured at. Null is allowed: a photograph can
  -- be taken of a patient's old file without them being here today.
  visit_id     TEXT REFERENCES visit(id),
  kind         TEXT NOT NULL CHECK (kind IN ('report', 'prescription_scan', 'old_paper_file', 'image')),
  caption      TEXT,
  -- The date written ON the paper, when somebody typed it in. Not the
  -- date the photograph was taken: a report from 2019 photographed
  -- tonight belongs to 2019 on the patient's timeline.
  document_date TEXT,
  captured_at  TEXT NOT NULL,

  -- The picture itself.
  content      BLOB NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
  byte_size    INTEGER NOT NULL,
  -- Checked every time it is read. A picture that does not match what
  -- was stored is reported loudly rather than shown as a broken box.
  sha256       TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  -- 'tablet' or 'laptop', so the pilot report can say where the
  -- photographs actually came from.
  source       TEXT NOT NULL DEFAULT 'laptop',

  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL REFERENCES app_user(id),
  deleted_at   TEXT,
  deleted_by   TEXT REFERENCES app_user(id),
  deleted_reason TEXT
);

CREATE INDEX idx_attachment_patient ON attachment(patient_id, captured_at);
CREATE INDEX idx_attachment_visit ON attachment(visit_id);

CREATE TRIGGER attachment_no_hard_delete
BEFORE DELETE ON attachment
BEGIN
  SELECT RAISE(ABORT, 'attachment rows are never deleted: set deleted_at instead');
END;

-- A photograph cannot be quietly swapped for a different one. Removing
-- it is a soft delete, which is what the deleted_at columns are for;
-- replacing the bytes under a row that a record points at is not
-- something this software ever needs to do.
CREATE TRIGGER attachment_content_is_never_replaced
BEFORE UPDATE ON attachment
WHEN NEW.content IS NOT OLD.content OR NEW.sha256 <> OLD.sha256
BEGIN
  SELECT RAISE(ABORT, 'the picture in an attachment is never replaced: add another one instead');
END;
