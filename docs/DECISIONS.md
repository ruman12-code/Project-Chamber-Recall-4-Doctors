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

## Milestone 3: the Recall Card

### 17. Real test names, placeholder diagnoses and medicines

You supplied the investigations and told me to fill in the rest, so the
practice data now names real tests: X-ray chest PA view, Urine R/E, CBC with
ESR, CRP, CT scan, Dengue NS1, and fourteen more common ones. The
outstanding-investigations block reads properly as a result, which matters,
because it is the highest-value item on the screen.

Diagnoses and medicines are still placeholders, because you have not given
me those and I will not write them. Naming a test that was ordered is not a
diagnosis and not a prescription; the other two are. After the briefing with
your cousin, send me his twenty most-written diagnoses and most-prescribed
medicines and the card will read entirely like his chamber. It is one file:
`src/main/seed/demo-vocabulary.ts`.

### 18. Consent: my recommendation, since you asked for it

Recorded **once per patient, with a version**. Each visit records which
consent was in force rather than asking again. If the consent wording ever
changes, the version changes and the patient is asked once more.

This avoids asking a returning patient eight times over four years while
keeping a complete audit trail, and it handles the case your original model
could not: knowing *which* consent someone actually agreed to. I will make
that schema change immediately before milestone 7, which is still before any
consent code exists.

### 19. English on the doctor's screen, Bangla on the patient's

Labels on the Recall Card are in English; patient content appears in
whatever script it was entered in, which is usually Bangla. The
patient-facing view is the other way round - it is in Bangla, because it is
physically turned towards the patient.

Printing every label in both languages on the Recall Card would cost roughly
a third of a screen that has to fit in one screen. If your cousin or a
future assistant would rather have the doctor's screen in Bangla, that is a
setting rather than a rewrite - say so and I will make it one.

### 20. Blood pressure is drawn as one measurement, not two

Systolic and diastolic are the top and bottom of the same thing. Giving them
competing colours turns a 44-pixel-tall chart into a puzzle. It is drawn as
a shaded band with two thin edges, in one colour, which reads as "blood
pressure" at a glance from across a desk. Only the most recent value is
labelled; a number on every point is noise at that size, and the recent
figures are in the vitals table beside it.

### 21. Two layout failures that only real data exposed

Both were found by rendering the card against the practice database rather
than against a hand-picked example, which is the reason for building it that
way.

**"What are you most worried about" was below the fold.** The intake panel
scrolled, and the two questions this entire front-desk interface exists to
ask had scrolled out of sight. The complaint is now pinned at the top of
that panel and those two questions are pinned at the bottom; only the
middle questions scroll.

**Three red flags pushed the vitals off the screen.** Each firing rule had
its own full-width banner. Three fired at once, ate a fifth of the screen,
and cut off the vitals table and the blood-sugar trend - on precisely the
patient whose card most needed to survive intact. It is now one banner
however many rules fire, with a hard ceiling on its height, and the text
shrinks rather than scrolling a warning out of sight.

### 22. A data bug worth naming: temperatures were in the wrong units

The practice data was generating body temperatures between 97.5 and 100.7
into a column called `temperature_c`. Those are Fahrenheit numbers in a
Celsius field. Nothing crashed and no test caught it - it only became
obvious when the vitals table was on screen with "TEMP °C 99.8" in it.

Fixed. The reason it is written down here rather than quietly corrected: it
is exactly the class of error that survives in clinical software, because
the value is plausible, the column accepts it, and only a person who knows
what a temperature looks like will ever notice.

---

## Milestone 4: search, registration, merging

### 23. Temperature: the unit is stated, never guessed

You asked for Fahrenheit entry with automatic conversion. It converts
automatically, but only once the person has said which scale they used.

Working the scale out from the number is tempting and wrong:

    38  is a fever in Celsius and impossible in Fahrenheit
    99  is normal in Fahrenheit and impossible in Celsius
    40  is a high fever in Celsius and hypothermia in Fahrenheit

A rule that gets it right ninety-nine times and silently wrong once has put
a wrong temperature into a patient's record, and it will look entirely
plausible there for ever. That is the same failure as the Fahrenheit numbers
that ended up in the Celsius column of the practice data.

So: a °C / °F switch beside the box, the converted value shown back before
saving, and everything stored in Celsius in one column. When a number looks
like the other scale the software asks — "99 °C is not a possible body
temperature. Did you mean 99 °F, which is 37.2 °C?" — and then stores
whatever the person decides. It asks; it never corrects and never blocks.

Built and tested now; it appears on screen at milestone 9 with the rest of
vitals entry.

### 24. Search never chooses for you

There is no function anywhere in this project that returns a single patient
for a search term. Even when exactly one person matches, the result is a
list of one and somebody picks them. If such a function existed, something
would eventually call it, and attaching a visit to the wrong record fuses
two people's histories silently.

There is also no phonetic matching, no fuzzy distance, and no cleverness of
any kind — Unicode normalisation and substring matching only, exactly as
your brief specifies. "Md. Rafiq" does not find "Mohammad Rafiq". That looks
like a limitation and is a deliberate one: a confident wrong first result at
a busy desk is far worse than making the assistant type another letter.

Phone numbers are the exception where cleverness is safe, because it is
arithmetic rather than judgement. 01712345678, 01712-345678, +8801712345678
and 0171 234 5678 all reduce to the same digits and find the same patient,
and so do just the last few digits.

### 25. A merged record stays, and stays findable

The duplicate is never deleted. It keeps its own name and phone number, is
still returned by search, and is marked with what it was merged into.

This matters more than it looks. The duplicate usually exists precisely
because it holds a different phone number - a son's handset, a number given
on a different evening. Hiding it would make the patient unfindable by the
very thing they say at the desk.

Nothing is combined either. The surviving record keeps its own details
exactly as they were; the software does not invent a merged version of two
people's details.

### 26. The merge tool has an undo, and that is not scope creep

Merging two records that really are one person is routine. Merging two
DIFFERENT people fuses two histories, and the doctor then reads somebody
else's blood pressure as though it were this patient's.

Your brief says the front desk must be able to fix duplicates without
telephoning anybody. The same sentence has to cover the mistake, or the
first wrong merge is exactly the phone call it was meant to prevent.

So every merge records the id of every visit and attachment that moved, and
undoing moves back precisely those and nothing else — not everything the
surviving record happens to have by then. There is a test for that specific
distinction, because it is the difference between an undo and a second
accident.

### 27. Two bugs in the practice data, both worth naming

**Seventeen patients shared one name.** The generator drew from a list of
sixteen complete names, so in a chamber of 312 there were seventeen people
called "রুবেল মিয়া". The search screen and the merge tool were impossible to
judge against that: every result looked like a duplicate and the deliberate
ones were invisible among the accidents. Names are now built from a given
name and a family name, giving a few hundred combinations. Collisions still
happen — a real chamber does see several men called Md. Rafiq — but four at
worst rather than seventeen.

**The seed collided with itself over serial numbers.** The historical
generator could place a visit on today's date in the same chamber that
today's session was numbering from 1, and the two fought over the same
serial. The database refused the write and rolled the entire seed back,
which is the unique constraint doing exactly its job. Fixed twice over:
history now stops yesterday, and today's session continues from whatever
serial has already been issued rather than assuming it starts empty.

Both were found by looking at real generated data rather than by a test, and
both are recorded here because "the practice data is misleading" is a
failure that quietly wastes your time when you review a screen.

---

## Milestone 5: the register and the queue

### 28. A serial number and a place in the queue are two different things

The serial is what the patient was TOLD. It is spoken aloud, written on a
slip and remembered, and it never changes. The queue position is who the
doctor sees next, and it can be changed.

They start equal and usually stay equal. When they do not, the patient still
holds serial 14, still hears "fourteen" called, and the screen still knows to
bring them in third. A register that renumbers people is a register nobody
trusts, so reordering the queue never touches a serial - there is a test that
holds every serial constant across a reorder.

### 29. The escalation rule, enforced in the queue itself

A patient whose intake fired a red flag sorts above the patients who did
not, automatically, and cannot be pushed back below them. The up and down
controls swap neighbours within the same group, so ordinary patients can be
reordered among themselves and flagged patients among themselves, but no
sequence of taps - careless or deliberate - moves a flagged patient behind an
unflagged one. There is no override and no dismiss.

They leave the flagged group by being seen, which is what the alert was
driving at in the first place.

One hole in that, which I found while looking at the finished screen: marking
somebody as having LEFT takes them off the list, and it is the only path that
removes a flagged patient without the doctor seeing them. The software cannot
stop a patient walking out, so it is allowed. It is not allowed to be quiet.
It asks first, and it writes its own audit entry -
`flagged_patient_left_unseen` - so "a flagged patient went home unseen" can
be found later without reading every status change in the log.

### 30. Reordering is by buttons and keyboard, not by dragging

Your brief says "by drag or by keyboard". It is buttons and keyboard.

Dragging on a touch screen misfires - a scroll gesture that starts on a row
becomes a drag - and a misfire here silently changes who the doctor sees
next. Up and down buttons at 44 pixels are unmissable with a thumb and cannot
half-happen. On the laptop, Alt with an arrow key does the same thing.

If you use it at the desk and want dragging as well, say so and I will add
it alongside the buttons rather than instead of them.

### 31. Somebody arriving twice is questioned, not refused

Adding the same patient to today's list twice is nearly always the assistant
tapping twice, so the software says so rather than silently issuing a second
serial. But it does happen for real - a patient sent away for a test and
coming back - so the answer is a question, not a refusal.

---

## Two more bugs worth recording

**Opening a database never upgraded it.** Creating a new installation ran the
schema migrations; opening an existing one did not. A chamber that had been
running since last year would have opened its database perfectly happily and
then failed on the first query touching anything added since. It surfaced as
the queue screen sitting on "Reading today's list" for ever, because the
column it needed had never been added. Opening now upgrades, and there is a
test that winds a database back to version 1, reopens it through the normal
path, and checks every later column is actually usable.

**The same silent failure as milestone 1, in a new screen.** The queue
checked "have I loaded yet" before "did it fail", so the error had nowhere to
render and the screen waited for ever. I had written the identical mistake in
the preload bridge in milestone 1 and fixed it there; I then made it again.
Both are fixed and both now have the failure check first, but the honest
lesson is that this is a shape of bug this codebase attracts, and it is worth
me checking for it deliberately on every screen that loads something.

**The practice data showed everybody as having waited zero minutes.** Today's
session was pinned to 17:00, so whenever the demo is opened before the
evening every arrival is in the future and every wait is zero. Arrivals now
run backwards from the moment the practice data is built, so the queue always
looks like an evening already in progress. It is not a bug in the product,
but "how long has this person been waiting" is one of the things the queue
exists to answer, and a demo that always answers zero cannot be judged.

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

---

## Answer to question F: the wording, for you to edit

You asked me to suggest it. Two states, both currently on the card and both
in amber rather than red, because missing information is a gap and not a
warning, and must not look like one:

**When some questions were skipped:**

> **Screening incomplete.** Not answered at the front desk: Where,
> Allergies. Red flag rules needing these could not be checked — ask
> directly.

**When nobody took an intake at all:**

> **No screening was done.** Nobody asked this patient any questions at the
> front desk, so no red flag rule has been checked for them. Take the
> history yourself.

Two things I would defend if your cousin pushes back on them. The first is
naming the specific questions rather than saying "some questions were
skipped" - the doctor then knows exactly what to ask instead of having to
re-take the whole history. The second is "ask directly" and "take the
history yourself": the sentence should end with an instruction, not with a
statement of fact, because a doctor reading this in twenty seconds needs to
know what to do about it.

Both are one-line edits in `src/renderer/screens/RecallCard.tsx` after the
briefing.

### I. New question: the alert's words are not saved with the alert

A fired red flag records which rule fired and in which version, but not the
sentence the assistant was actually shown. The card looks that text up from
the rules file as it stands now.

So if a rule is reworded or deleted without its version being increased, an
old alert loses the words that went with it, and the card says "this rule is
no longer in the rules file as this version" instead. That is honest but it
is not good enough for a record that may be looked at after a complaint.

The fix is small: store the message text on the event when it fires, so the
record keeps the words the assistant saw. I would do it at milestone 6, when
alerts start being raised for real rather than by the practice data. Say if
you would rather I did it sooner.

### J. Nothing is attributed to a person yet, and the rule says it must be

Your brief is explicit: every clinical field records who entered it, and
attribution is never optional. The database enforces that — those columns
are NOT NULL and no row can be written without them.

But there is no sign-in yet. It arrives with the setup wizard at milestone
9, which is where you placed it. Until then everything done through the
interface is recorded against a role with no named person: front desk, but
not *which* front desk.

That is fine while the only data is practice data. It stops being fine the
moment a real patient is entered. So, concretely: **do not let anyone use
this for real patients before milestone 9 is done**, even if the earlier
screens look finished enough to try. Records created before then would carry
a role and no name, and that cannot be repaired afterwards — there is
nothing to look the answer up from.

If you want to start the pilot earlier than milestone 9, tell me and I will
move the sign-in forward. It is a small piece of work in the wrong order
rather than a hard problem.
