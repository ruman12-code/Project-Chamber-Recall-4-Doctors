# Chamber Recall

An offline patient-history system for a private doctor's chamber.
One laptop, one encrypted database file, no internet at any point.

**Status: milestone 3 of 13.** Foundations, the safety layer, and the
Recall Card as a static mockup. There is no register, no intake and no
prescription printing yet.

---

## What exists today

- An encrypted SQLite database (SQLCipher) that will not open without the
  doctor's password or his printed recovery key.
- The complete database schema for the whole project, in one readable file:
  [`src/main/db/schema.sql`](src/main/db/schema.sql).
- The three roles, and the rules about who may enter what.
- An audit log the database itself refuses to let anything edit or delete.
- Usage logging, which the pilot report will be built from.
- **The red flag layer.** Screening rules in a file a doctor edits by hand,
  a deterministic evaluator, and a guard that refuses to open a real
  patient database until a clinician has approved the rules.
- **The Recall Card**, as a static mockup on the practice database. One
  screen at 1366x768 with no scrolling, plus the patient-facing view.
- A practice database: 312 invented patients, 1,469 visits across two
  chambers over four years, real rule evaluations, and a session running
  today with people waiting and one patient in the chamber.
- 191 tests covering key custody, the database layer, the practice data,
  the rule evaluator, the refuse-to-run guard and the Recall Card.

## Running it

```bash
npm install
npm test                # 78 tests
npm run seed            # build the practice database in ./data/demo
npm start               # open the application
```

To open the application against the practice database:

```bash
CHAMBER_RECALL_DATA_DIR=./data/demo npm start
# password: practice
```

Without `CHAMBER_RECALL_DATA_DIR` the application uses its own folder and
offers to set up a fresh installation.

## Where things live

```
src/main/db/schema.sql    the data model, commented. Read this first.
src/main/db/migrations/   every change to it since
src/main/keystore/        where the encryption key lives, and why
src/main/db/              opening, migrating, audit log, usage log
src/main/redflags/        the safety layer: rules, evaluator, guard
src/main/recall/          assembling the Recall Card
config/red_flags.yaml     the rules template, written for a doctor to edit
src/main/seed/            the practice data generator
src/main/index.ts         the application process
src/renderer/             the screens
tests/                    what is proven, in plain language
docs/DECISIONS.md         every judgement call made, and the open questions
```

## The red flag layer

The rules live in `red_flags.yaml`, in the data folder beside the database,
so the doctor edits them himself and reinstalling the software never
overwrites them. The copy in `config/` is only the template used on first
run.

**The software refuses to open a real patient database until those rules
have been approved by a clinician.** Not a warning: it will not proceed.
The rules shipped with the software are placeholders and are rejected.

Three properties the rest of the project depends on:

- **A typo cannot produce a rule that silently never fires.** A misspelled
  keyword or a question that does not exist rejects the whole file with a
  line number, rather than loading a rule that can never match.
- **A skipped question never quietly means "no".** A rule that lacks the
  answers it needs is recorded as `could_not_check`, and the screening is
  reported as incomplete. Skipping questions cannot switch off the safety
  layer without leaving a trace.
- **Every evaluation is recorded, not only the ones that fired.** Explaining
  why a patient was *not* moved up the queue needs the rules that did not
  fire as much as the one that did.

## Two things worth knowing before you touch anything

**The database refuses to be rewritten.** Audit rows cannot be updated or
deleted, and no clinical row can be hard deleted, because of triggers in
`schema.sql`. This is enforced by the database and not by convention, so a
future mistake cannot quietly undo it. To remove something, set its
`deleted_at`.

**Practice data and real patients can never share a file.** Every database
is marked `demo` or `live` at the moment it is created. The seed script
refuses to write into a `live` database, and refuses to write into any
database that already has patients in it.

## Backups

There is no backup feature yet; it arrives at milestone 12. Until then,
copying the whole data folder is the backup. The folder holds the database
and the key file, and both are needed.
