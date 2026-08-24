# Chamber Recall

An offline patient-history system for a private doctor's chamber.
One laptop, one encrypted database file, no internet at any point.

**Status: all thirteen milestones built.** Foundations and the safety
layer; patient search, registration and merging; the serial register and
its live queue; the tablet intake; consent; the Recall Card with Confirm
and Correct; sign-in for everybody who works here; vitals and the
consultation; the printed prescription; photographs of the paper patients
bring in; verified backups; the copy of their record a patient can ask
for; and the pilot report.

**It has not been used by a patient yet.** What has to happen before it is
is listed below, and the software refuses to run past most of it.

**Before any real patient:** the red flag rules and the consent wording
need approving by the supervising physician, a lawyer in Bangladesh needs
to read the consent, and the spoken recording needs making. The software
refuses to run against a real database until the rules are approved, and
refuses to take an intake until the consent wording is. See
[docs/CONSENT.md](docs/CONSENT.md).

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
- **The Recall Card.** One screen at 1366x768 with no scrolling, plus the
  patient-facing view.
- A practice database: 312 invented patients, 1,469 visits across two
  chambers over four years, real rule evaluations, and a session running
  today with people waiting and one patient in the chamber.
- **Patient search, registration and the merge tool.** Search by phone or
  name in either script, register someone new, and put duplicate records
  together — with an undo that puts back exactly what moved.
- **The serial register and live queue.** Give arriving patients their
  number, see who is waiting and for how long, change who is seen next,
  and print today's list. A flagged patient is held at the front of the
  queue and there is no control anywhere that moves them back.
- **The serial register, at the front desk.** The tablet finds a returning
  patient by phone or name, registers somebody new, and gives them their
  number — the one part of the tablet that needs the laptop reachable,
  because a serial has to be unique for the whole chamber, and it says so
  plainly when it is not.
- **The tablet intake.** Questions from a file the doctor edits, one per
  screen, Bangla first, a Skip on every question, and an offline buffer
  so a dropped wifi loses nothing. The tablet checks the red flag rules
  itself, so a warning appears with no connection at all.
- **Consent**, recorded per patient and versioned, with a separate
  research opt-in. Refusing is one tap; agreeing is not possible until
  the patient has actually been told, by recording or read aloud.
- **The Recall Card wired live, with Confirm and Correct.** What the front
  desk wrote is a report until the doctor accepts it; confirming stamps his
  name and the time on it, and correcting puts his wording beside the
  patient's without ever replacing it. Any patient on today's list can be
  opened from the queue.
- **Sign-in.** Everybody who works here has an account and a PIN, on the
  laptop and on the tablet. Every record carries the name of the person
  who wrote it, and nothing clinical can be recorded until at least one
  doctor has been set up.
- **Vitals and the consultation.** Seven readings with the temperature
  typed in either scale, complaint, examination, diagnosis, decision,
  follow-up, prescription and tests — all of it saving as it is typed.
  Confirming is the doctor's signature, and the database itself refuses
  to let a confirmed consultation be changed without a recorded undo.
- **The printed prescription.** A5 or A4, with the doctor's own letterhead
  from a file he edits himself, everything on it typed by a person. It
  will not print before the consultation is signed, and it will not print
  at all for a real patient while the letterhead still says PLACEHOLDER.
- **Photographs of paper.** The front desk photographs a patient's old
  reports and prescriptions on the tablet while taking the history; the
  doctor looks at them beside the Recall Card. The pictures live inside
  the encrypted database, are never altered, and are never taken for a
  patient who said no.
- **Backups that are checked.** A copy goes to a USB stick, is opened and
  read back before the program calls it a backup, and carries plain
  instructions for putting it back. The main screen says how many days it
  has been and turns red when that is too many.
- **A patient's own copy.** Printed as a summary or written out as a
  complete file with their photographed reports — the thing the consent
  wording promises and the Personal Data Protection Act requires.
- **The pilot report.** What has happened since this started — who was
  seen, what the questions caught, what was written down, and what did
  not work — counted per assistant, with no percentages below twenty
  cases and no verdict anywhere on it. It ends with the six questions it
  cannot answer.
- **A de-identified export** for the research those patients agreed to
  separately, carrying coded answers and numbers and no free text at all.
- 610 tests covering key custody, the database layer, the practice data,
  the rule evaluator, the refuse-to-run guard, the Recall Card, patient
  matching, the merge tool, temperature entry, the register, the queue,
  the question engine, the network server, the offline buffer, confirming
  and correcting an intake, PINs and sign-in, the consultation, and the
  printed prescription, photographs of paper, backups, and a patient's
  own copy of their record, and the pilot report.

## Getting it onto the chamber laptop

For the doctor, or anybody who is not going to edit the code, there is an
installer: **[docs/INSTALL-WINDOWS.md](docs/INSTALL-WINDOWS.md)**. Windows
10 or newer, one file, no development tools of any kind. That document
also covers the first run, the recovery key, and how to sit down and show
the program to somebody.

Build the installer with `npm run dist:win`, or press **Run workflow** on
the repository's **Actions** tab → **Windows installer** and download it
from the finished run, under **Artifacts**. GitHub wraps artifacts in a
`.zip`; the installer is inside it. The run does the checks and the
typecheck before it builds, so a red run leaves no file behind.

## Running it from source

Node 22 or newer. Nothing here compiles native code, so no build tools are
needed on any platform.

```bash
npm install
npm test                # 610 checks
npm start               # build and open the application
```

`npm start` opens a fresh installation, which offers to fill itself with
practice patients on the first screen. To point it at a different folder
instead — a second practice database, or a copy taken off a backup:

```bash
CHAMBER_RECALL_DATA_DIR=./data/demo npm start
```

And to build one from the command line rather than from the first screen:

```bash
npm run seed -- --dir ./data/demo --passphrase practice
```

A note on the checks: they are run by `scripts/run-tests.js` rather than
by `node --test` directly. Node's runner prints `not ok` for a group whose
setup throws and then exits 0 anyway, which hid a broken group here for
two milestones. The wrapper fails when `not ok` appears at all.

## Where things live

```
src/main/db/schema.sql    the data model, commented. Read this first.
src/main/db/migrations/   every change to it since
src/main/keystore/        where the encryption key lives, and why
src/main/db/              opening, migrating, audit log, usage log
src/main/redflags/        the safety layer: rules, evaluator, guard
src/main/recall/          assembling the Recall Card
src/main/patients/        search, registration, merging
src/main/queue/           the serial register and the live queue
src/main/intake/          the question file, the flow, taking an intake
src/main/server/          the local network server and tablet pairing
src/main/rules/           the condition language both yaml files share
src/main/consent/         the consent wording, and what each patient decided
config/consent.yaml       what the patient is told, written for review
docs/CONSENT.md           what the law requires and where the software meets it
docs/ANDROID-TABLET.md    setting up and locking down the tablet
src/tablet/               the tablet page: intake, offline buffer
config/questions.yaml     the intake questions, written for a doctor to edit
src/main/vitals/          temperature entry in either scale
src/main/auth/            PINs, who works here, signing in
src/main/clinical/        vitals, the consultation, and who may write what
src/main/prescription/    the letterhead, and building the printed sheet
src/main/attachments/     photographs of the paper a patient brings in
src/main/backup/          taking a backup, checking one, putting one back
src/main/export/          the copy of their record a patient can ask for
src/main/report/          the pilot report, and the research export
config/prescription.yaml  the letterhead, written for the doctor to fill in
config/red_flags.yaml     the rules template, written for a doctor to edit
src/main/seed/            the practice data generator
src/main/index.ts         the application process
src/renderer/             the screens
tests/                    what is proven, in plain language
docs/DECISIONS.md         every judgement call made, and the open questions
docs/INSTALL-WINDOWS.md   installing on the chamber laptop, and the first evening
docs/RUN-FROM-SOURCE.md   running it the way a developer does, step by step
docs/briefing/            the briefing written for the doctor, on screen and on paper
electron-builder.yml      how the program becomes an installer
scripts/run-tests.js      the checks, and why they are not run by node directly
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

## The tablet

The laptop serves a page on the chamber's own network; the tablet is a
browser pointed at it. There is no internet at any point — it works with
the router unplugged from the outside line.

```
npm start                 # the laptop; it prints the address to use
```

The laptop screen shows the address and a short pairing code. The tablet
is given the code once and holds a token afterwards. **Nothing on the
network can read the waiting list or the questions without pairing.**

Two properties the front desk depends on:

- **A dropped wifi loses nothing.** Everything the assistant does goes
  into a buffer on the tablet first and is sent in the background, oldest
  first. It survives the page being reloaded and the tablet being
  switched off. Every route it uses can be called twice with the same
  thing and change nothing.
- **A warning still appears with no connection.** The tablet holds its
  own copy of the rules and checks them itself. The laptop re-checks on
  arrival and its record is the one that counts; the tablet's copy only
  decides how soon the assistant sees the screen.

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

Built, and checked rather than assumed: the program copies the database to
a USB stick, then **opens the copy and reads it back** before it will call
it a backup. The main screen counts the days since the last one and turns
red when that is too many. A restore puts the current folder aside rather
than overwriting it, so a restore from the wrong stick is recoverable.

The data folder holds the database and the key file, and both are needed.
Uninstalling the program never touches that folder.
