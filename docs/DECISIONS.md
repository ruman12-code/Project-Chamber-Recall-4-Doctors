# Decisions and open questions

Every judgement call made while building this, written in plain language.
The rule for this file: if I made an assumption about clinical safety or
about your data, it goes here where you can read it, not in a code comment
where you cannot.

---

## Decided with you before any code was written

### 1. Electron rather than Tauri

The written brief specified Tauri and invited an argument for Electron. The
argument, and the reason you chose it:

Tauri is the better-engineered choice on almost every axis — a far smaller
binary, much lower memory on an old laptop, and a more robust path to
SQLCipher through Rust. It loses on the two axes that decide this
particular project. First, printing: Tauri renders through whatever WebView
happens to be installed on that machine, so the A5 prescription is laid out
by an engine you cannot pin, cannot test against, and which changes under
you when Windows updates. Electron carries its own Chromium, so the slip
you approve in week one is the slip that prints in week twelve, on every
laptop. The brief calls a prescription that does not match his existing
paper an adoption blocker that ends the pilot in week two — that is the
whole argument. Second, installation: the standard Tauri installer for
Windows fetches the WebView2 runtime from the internet, and this deployment
has no internet. Electron's installer is self-contained. The costs you
accepted are a roughly 150 MB application and higher idle memory.

### 2. Where the encryption key lives

There is one random 256-bit key that encrypts the database. It is stored
twice in a small file beside the database: once locked by the doctor's
password, once locked by a recovery key printed at setup. Either opens the
records.

This was chosen over deriving the key straight from the password, because
that would mean a forgotten password destroys every patient record in the
chamber permanently, and changing the password would require re-encrypting
the entire database. It was chosen over sealing the key to the Windows
login, because that leaves a stolen laptop readable by anyone who gets past
one login.

What it protects: a stolen laptop, a copied database file, a lost backup
USB stick. None of them can be read without the password or the recovery
key. What it does not protect: someone using the doctor's already-unlocked,
running application. That is a physical problem, not a cryptographic one.

The setup screen will not continue until the doctor confirms he has stored
the recovery key somewhere other than the laptop. That confirmation is a
checkbox, which is weak, and I would rather it were a printout — see open
question B.

### 3. `working_diagnosis` is a text box, not a feature

You confirmed the reading: the prohibition binds the software, not the
doctor. The column stores what a clinician typed, verbatim, and shows it
back unchanged. Nothing in this system generates, suggests, autocompletes,
ranks, infers or groups a diagnosis by meaning. The recurring-diagnoses
block on the Recall Card will group by exact text match only.

---

## Decided by me, and why

### 4. I added a table that was not in your data model: `app_user`

Every table in your model says who entered each field — `created_by`,
`recorded_by`, `entered_by`. Those references need somewhere to point, so
there is a `app_user` table holding a name and one of the three roles.
Login credentials exist as columns but are unused until the setup wizard at
milestone 9, which is where you said roles get configured.

### 5. I added one column to your audit log: `details_json`

Your model gives the audit log an action, an entity and an id. That is
enough to know a merge happened, but not enough to know *which two records
were merged*, which makes an audited merge impossible to reconstruct or
reverse months later. `details_json` holds that context. It never contains
a password or the recovery key.

### 6. I added one column to your patient table: `approx_age_recorded_on`

Your model has "dob or approx_age". An approximate age without the date it
was taken is a small time bomb: a patient recorded as 45 three years ago
still reads as 45 today, on the doctor's screen, forever. The column is
paired with the age by a database constraint, so one cannot be stored
without the other. Age must always be aged forward from that date before it
is displayed.

### 7. Writes are set to survive a power cut, at a cost in speed

The database is configured with `synchronous = FULL`, which means a saved
record has physically reached the disk before the screen says it is saved.
This is slower than the usual default. Given routine load-shedding at the
pilot site, I took the trade: an encounter that evaporates because it was
still in a disk cache is the exact failure this project exists to prevent.

### 8. The practice data contains no invented diagnoses or medicine names

Complaints, worries and hopes in the practice data are realistic, because
they are the patient's own words and because the Recall Card cannot be
judged for legibility against text of the wrong length. Diagnoses, medicine
names and test names are obvious placeholders: `PLACEHOLDER DIAGNOSIS A`,
`PLACEHOLDER DRUG 1`.

That rule does not stop applying because the data is fake. If I invented
two hundred plausible diagnoses and drug names to make the demo look good,
they would be my clinical text sitting in a database, and the first person
to see the demo would reasonably assume a clinician wrote them.

This has a cost, and you should know it before milestone 3: the Recall Card
mockup will read as `PLACEHOLDER DIAGNOSIS C` where a real card would read
as a real diagnosis. See open question A.

### 9. The practice data is deliberately awkward

It contains shared phone numbers, patients with no phone at all, duplicate
records with drifted spellings, abandoned intakes, skipped questions,
unconfirmed encounters, and two front-desk assistants with measurably
different speed and skip rates. Uniform data would make a pilot report that
averages assistants together look perfectly reasonable.

---

## Milestone 2: the safety layer

### 10. Rules are checked strictly, and a doubtful file is rejected whole

The rules file is the one file a doctor edits without a programmer, so the
most likely fault is a typo. The dangerous kind is a typo that leaves a rule
looking perfectly fine and unable to ever fire: `equal:` instead of
`equals:`, or a question name spelled `severty`.

The loader rejects the whole file when it sees either, and says which line
and what to fix. It refuses rather than loading the rules it *could*
understand, because a partly-loaded rulebook is a safety layer with an
invisible hole in it. A file that will not load blocks live use entirely.

### 11. A skipped question is a third answer, not a "no"

Every intake question can be skipped, so rules frequently run without what
they need. There are three outcomes, not two: matched, did not match, and
could not be checked.

If a skipped question were treated as "no", then skipping questions would
quietly switch off the screening, and nothing would record that it had
happened. That is a de-escalation by accident. So "could not be checked" is
recorded against the rule, the missing questions are named, and the
screening is reported as incomplete.

The logic follows from that. In an `all:`, one part definitely false settles
it - the rule could not have fired whatever the missing answer was, so
nothing is reported as incomplete. In an `any:`, one part definitely true
settles it the same way. Only a genuinely undecidable rule is reported.

### 12. Every evaluation is written down, not only the alerts

The brief asked for this and the reason deserves stating: to explain why a
patient was *not* moved up the queue, knowing that no alert fired is not
enough. You need to know which rules ran, in which version, and what each
one decided. A new table records all of it, append-only like the audit log.

Each row also carries a fingerprint of the whole rules file. Rule versions
depend on the doctor remembering to increase them; the fingerprint does not.

### 13. The alert says nothing about how serious anything is

The full-screen warning appears on a tablet at a front desk. The patient and
whoever came with them can read it from across the desk. So it carries no
score, no level, no rating, and no word like urgent or critical - only the
instruction to see the doctor now rather than wait, which is true and not
frightening, plus the message the physician wrote for that rule.

Bangla and English are both always on screen, larger and first in Bangla.
Neither is behind a language toggle: there is no time to switch languages in
the moment this screen exists for.

### 14. Acknowledging on the tablet does not clear the doctor's alert

The assistant taps to confirm they have read the warning, and that is
recorded with their identity, the time and the rule version. It clears the
tablet so the queue can move on. It does not clear the doctor's screen: that
alert is derived from who is still waiting, so it stays until the patient
has actually been seen. It cannot be dismissed, only outlived.

The first acknowledgement is the one kept, and is never overwritten.

### 15. An intake is screened repeatedly, and that must not duplicate alerts

The tablet will re-screen after every answer, so a warning appears as early
as possible rather than at the end of the questions. That means a matching
rule matches again on every later answer. The alert is raised once and keeps
its identity; a rule whose version the doctor has increased counts as a new
rule and can fire again. Every one of those re-screenings is still recorded.

### 16. Changes to the data model now go through migrations

Adding the evaluation table needed a schema change, and there will be more.
`schema.sql` is the baseline and each later change is a numbered file in
`src/main/db/migrations/`. A new database gets the baseline and then every
migration; an existing one gets only what it has not seen. Both run the same
sql, and a test proves a migrated database ends up byte-identical to a fresh
one rather than assuming it.

Doing this now was cheap because no real data exists yet. It would not have
been later.

---

## A bug worth recording, because the symptom is the point

The first time the application ran end to end, it showed "Starting…" and
sat there forever. Nothing was broken on screen, nothing appeared in any
log the user could see.

The cause was narrow: the bridge between the screen and the database was
loading a file the security sandbox does not permit, so it never loaded at
all. The screen then waited for an answer that was never coming.

The cause is fixed. More importantly, so is the symptom: the screen now
says, in plain language, that it cannot reach the patient records and what
to do about it. And there is a test that fails if that bridge is ever
broken the same way again. A clinical system that hangs quietly is worse
than one that crashes, because the user assumes it is working.

---

## Open questions for you

These are not blocking milestone 2. They want an answer before the
milestone named against each.

### A. Should the practice data read realistically? (before milestone 3)

Milestone 3 is the Recall Card mockup, and you judge it. Right now it will
show `PLACEHOLDER DIAGNOSIS C` where a real card shows a real diagnosis.

If you send me the twenty diagnoses you most often write, the medicines you
most often prescribe, and the tests you most often order — in your own
words — I will put them in the practice data and the mockup will look like
your own chamber. That is a five-minute edit to one file
(`src/main/seed/demo-vocabulary.ts`). I am not willing to invent that list
myself, for the reason in decision 8.

### B. The recovery key currently relies on a checkbox

At setup the doctor sees the recovery key once and ticks a box saying he
has stored it. A checkbox is a weak guarantee for the one thing standing
between a forgotten password and the permanent loss of every record.

Options, in increasing order of nuisance: leave it as a checkbox; require
the key to be printed before continuing; require him to type it back in to
prove he wrote it down correctly. I lean towards typing it back, and it
costs about thirty seconds, once, forever. Your call.

### C. Consent is recorded per visit, which means asking every time

Your data model puts consent on `Intake`, so it is recorded per visit. I
have built it that way. But it means a patient who comes eight times over
four years is asked for consent eight times, which is either good practice
or an irritation depending on your view.

The alternative is consent recorded once per patient, with the visit
recording only that consent was already in place. That is a schema change,
and it is much cheaper now than after milestone 7. Which do you want?

### D. Registration happens before consent

Consent is taken at the start of the intake, per your brief. But the
serial register runs first — a patient's name, phone and address are in the
database before any consent screen appears, because they have to be for the
register to work at all.

I think this is correct and unavoidable: the register replaces a paper book
that already recorded exactly those things, and consent covers the
additional history. But it does mean the consent screen cannot honestly say
"before any data is recorded". I would like you to confirm you are
comfortable with that, and I will word the consent screen accordingly at
milestone 7.

### E. A patient may currently be registered with no age at all

Every intake question can be skipped, and I extended that leniency to
registration: name is required, everything else can be left blank. So a
patient can exist with no age and no sex, and the Recall Card will have
blanks where a doctor expects numbers.

I think leniency is right — an assistant blocked by a mandatory field
abandons the tool — but it is your clinical call whether age and sex should
be the two exceptions that must be filled in before a serial is issued.

### F. Incomplete screening is common, and the doctor's screen has to say something

In the practice database, 649 of 1,040 intakes had at least one rule that
could not be checked because a question was skipped. That number depends on
placeholder rules and will change completely once you write real ones, but
the mechanism is real and it will not go to zero: assistants under queue
pressure skip questions, and that is allowed by design.

So the Recall Card has to say something. My proposal for milestone 8 is a
line near the red flag block reading "screening incomplete - these questions
were not answered", listing them, so you know what you are missing before
you start asking. I would rather not decide the wording without you. It is
also worth deciding whether an incomplete screening should be visible in the
queue *before* the patient reaches you, rather than only on their card.

### G. A patient with no intake at all is currently screened by nothing

If the assistant never starts the intake - a rush, a patient who does not
want to answer - then no rules run, no evaluations are recorded, and nothing
anywhere says that this patient was never screened. The register still works
and the patient still gets a serial, which is correct. But the absence is
invisible.

I think the queue and the Recall Card should show "no screening was done"
for such a patient, as plainly as they show an alert. That is more
information for you, never less, so it does not breach the escalate-only
rule. Confirm and I will build it into milestones 5 and 8.

### H. Rule versions depend on you remembering to increase them

If you change what a rule does and leave `version: 1`, old records and new
records both point at "version 1" while meaning different things. I have
covered this partly: every evaluation also stores a fingerprint of the whole
file, so the exact rulebook can always be identified even when the version
number lied.

A stricter option exists: the software could refuse to load a rule whose
text has changed while its version has not, by remembering the fingerprint
of each rule. That is real protection but it would block you mid-edit while
you are working on the file. I have not built it. Say the word if you want
it.
