-- Schema 6: somebody for the record to point at before sign-in exists.
--
-- The rule for this project is that every clinical field records who
-- entered it, and the database enforces it: those columns are NOT NULL.
-- But sign-in does not arrive until the setup wizard, and until then
-- the application had nobody to name - so writing a patient from the
-- running program failed on the constraint. It was found by a test
-- doing exactly what the front desk screen does.
--
-- The fix is not to relax the constraint. It is to have a real row that
-- says, honestly, that nobody was signed in yet:
--
--   "Front desk (before sign-in was set up)"
--
-- Records made before the wizard therefore carry a name that is true.
-- They do not pretend to be attributed to a person, and they cannot be
-- mistaken for a record made by one.
INSERT OR IGNORE INTO app_user (id, display_name, role, is_active, created_at) VALUES
  ('unassigned-doctor',
   'Doctor (before sign-in was set up)',             'doctor',             1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('unassigned-clinical-assistant',
   'Assistant (before sign-in was set up)',          'clinical_assistant', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('unassigned-front-desk',
   'Front desk (before sign-in was set up)',         'front_desk',         1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
