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

## Milestone 6: the tablet intake

### 32. The two hand-edited files now share one language, and one list

`red_flags.yaml` and `questions.yaml` use the same wording for conditions,
because a doctor should learn one small language rather than two, and because
the part of this system that decides things should be written once and tested
once.

More importantly, the rules are now checked against the questions that
actually exist. In milestone 2 the rule loader held its own list of question
names with a comment warning that it MUST stay in step with a question file
that did not exist yet. It now reads the real one, so a rule about a question
nobody asks is rejected instead of sitting there unable to fire, and the two
cannot drift apart.

### 33. Private questions are refused at the front desk, not merely discouraged

Your brief lists the questions that must not be asked where other patients
can hear: menstruation, pregnancy, sexual health, mental health, alcohol and
drugs, trouble at home. The software refuses to load a question keyed to any
of those, and says where the question does belong.

It also *warns*, without refusing, when a question's wording looks private
under an innocent key - "Are you pregnant?" filed as `q17`. A warning rather
than a refusal because matching words is a guess, and refusing on a guess
would eventually block a legitimate question with no way round it.

This is the one place the software overrules a doctor, so it should be said
plainly: it is not a judgement about whether those questions matter. They
matter enormously, which is exactly why asking them in a waiting room gets an
answer that is a lie.

### 34. The tablet checks the rules itself, and the laptop still decides

If red flags were only evaluated on the laptop, a dropped wifi would switch
off the safety layer silently - the worst possible failure in this system.

So the tablet holds its own copy of the rules and runs the same evaluator, in
the same code, and the warning appears instantly whether or not there is a
connection. When the answers reach the laptop it re-evaluates and writes down
what IT decided. If the two ever disagreed, the laptop's record stands and
the assistant was still shown a warning - an extra warning being the only
direction this system is allowed to err in.

### 35. Everything the tablet sends is keyed by the visit, never by the intake

The tablet may be offline from the very first question, so it cannot know an
intake id. Starting an intake is idempotent, so the laptop works it out on
arrival - including when the first thing it ever hears about a patient is an
answer. That is what lets the whole buffer be replayed in order without any
entry needing to know what happened on the laptop.

Acknowledging a red flag works the same way: by which rule fired, not by an
alert id the tablet may never have seen.

### 36. The tablet has to be paired, and why that is not paranoia

The tablet reaches the laptop over the chamber's wifi. So does everything
else on that wifi. Without pairing, any phone in the waiting room could read
the day's list of patients and every answer given at the desk.

The laptop shows a six-character code; the tablet is given it once and holds
a long random token afterwards. Only a hash of the token is stored. The code
changes every time the program starts and again after each pairing, and after
a handful of wrong guesses pairing locks until the program is restarted -
because a code short enough to type is short enough to guess.

### 37. "Clear after fifteen minutes" clears the screen, not the answers

Your brief asks for un-submitted intakes to be discarded after fifteen
minutes idle. What is discarded is what is ON SCREEN: the tablet returns to
the patient list so the next patient never sees the last one's answers.

What was already answered is kept. It is on the laptop, or in the buffer
waiting to go, and the intake is marked unfinished - which the doctor's
screen already reports honestly. Throwing away what a patient actually said,
because an assistant was called away, would be the one thing this project
refuses to do.

### 38. Kiosk mode is only as good as the tablet allows, and I will not pretend otherwise

The page fills the screen, offers no way out of the flow, and has no links
anywhere. That is the limit of what a web page can do.

Genuinely locking a tablet to one app is done by the tablet's own operating
system - screen pinning on Android, Guided Access on an iPad - and has to be
switched on there, once, by hand. Nothing I write in the page can substitute
for it. See open question L: tell me which tablet you are buying and I will
write the exact steps for that device.

---

## Milestone 7: consent

The legal reasoning is in [CONSENT.md](CONSENT.md), written for you and for
a lawyer to read together. What follows is only the design decisions.

### 39. The law changed while this project was being built

Bangladesh now has comprehensive data protection legislation, and it is
recent enough that most people have not caught up with it: an Ordinance
gazetted in November 2025, amended in February 2026, replaced by the
Personal Data Protection Act in April 2026, with enforcement phased in to
around May 2027.

**Health information is sensitive personal data under it**, requiring
explicit consent and heightened security. That is not a detail — it is the
whole of what this software collects.

The pilot sits inside the run-up to enforcement. That is a reason to build
it correctly now, while there are no records to retrofit, not a reason to
defer it.

### 40. Refusing is one tap. Agreeing is not.

Saying no is available the moment the screen appears, before anything has
been played or read, and it is never behind a scroll or a checkbox. A
refusal that costs more effort than agreement is not a free choice.

Agreeing is deliberately harder: the button stays disabled until either the
recording has played or the assistant has confirmed they read the words
aloud. Consent from somebody shown a wall of text they cannot read is not
informed consent, and a great many patients here cannot read it.

Which of the two happened is stored on the record, so the pilot report can
show how often each was used. If it turns out to be "screen only" most of
the time, that is a finding about the consent process, not a statistic to
bury.

### 41. Consent is per patient and versioned, which answers question C

You asked me to decide this in milestone 4 and I said I would make the
change before milestone 7. This is it.

Asking the same person at every visit is not better consent; it is a ritual
both sides learn to tap through. Consent is recorded once per patient
against a **version of the wording**. Change what the patient is agreeing
to, change the version, and everybody is asked again. Each visit records
which version was in force, so any record traces back to the exact words
that patient agreed to.

### 42. Who agreed is recorded, because it is often not the patient

Patients arrive with a son, a daughter-in-law, a neighbour who does the
talking. The tablet asks who is answering. A record that quietly treats a
relative's agreement as the patient's own is a record that lies, and the
doctor reading that history later has a right to know.

### 43. Withdrawal means two different things, and the software says so

The Act gives a right to withdraw at any time, and the two permissions are
not the same in practice:

**Research consent stops completely and at once.** The export list is built
from who said *yes*, never from a list of who to leave out. A mistake in an
opt-out list quietly includes somebody who refused; the same mistake here
quietly leaves out somebody who agreed, which harms nobody.

**Withdrawing consent to a care record stops anything NEW being recorded.**
What is already there is a medical record. Destroying it is a clinical and
legal decision for you to make and to document, not something an assistant
does with one tap at a front desk. The request is recorded so you see it.

That distinction is the one thing in this milestone I would most like a
lawyer to look at, and it is flagged as an open point in CONSENT.md.

### 44. Declining does not cost the patient their place

Saying no ends the questions and nothing else. The serial stands, the doctor
sees them exactly the same, and the consent wording says so out loud.

The register entry — name, phone, serial — stays either way, and the wording
says that too. Seeing a doctor at all requires being on the list; pretending
otherwise would be a promise the software cannot keep. **This is a point for
the lawyer to confirm**: the basis for that minimum record is that it is
necessary to provide the service the patient came for, not consent.

### 45. The software will not ask anybody until the wording is approved

Same pattern as the red flag rules. `consent.yaml` ships with real draft
text — so there is something to review rather than a blank page — but
`approved_by` and `approved_on` are empty and the version says "draft".
While any of those is true, a live chamber cannot take an intake.

Two people have to sign it, not one: the physician, because it describes
what happens to a patient's medical history, and a lawyer, because health
data is sensitive personal data under a statute nobody has case law for yet.

### 46. I cannot record the audio, and pretending otherwise would be worse

The consent has to be spoken by a real person, in Bangla, reading those
exact words. Until that file exists the tablet says so in a box the
assistant cannot miss, tells them to read the words aloud, and records that
this is what happened.

---

## Milestone 8: the Recall Card wired to the record

### 47. Confirming is the only moment intake becomes part of the record

Everything the front desk takes is, until this moment, a report of what a
patient said to somebody. The card labels it that way in brown, and the
doctor sees the label before he sees a single answer.

Confirming stamps his name and the time on it. Nothing else on the panel
changes colour or moves: the words stay the patient's words, and the panel
stays walled off from the clinical record beside it. Confirming twice is not
an error, but it never moves the time of the first confirmation.

Undoing is possible, because a doctor who confirms the wrong patient's
history needs a way back. The way back is another recorded event, not an
erasure — the audit log keeps both.

### 48. A correction never replaces what the patient said

The front desk answer is evidence of what a patient told somebody. Software
that quietly swaps in a tidier version destroys that evidence, and a year
later nobody can tell which sentence came from the patient.

So `intake_correction` is a separate append-only table. The card shows the
doctor's wording as the answer, and underneath it, smaller, "front desk
had" with the original — struck through when he marked it wrong. Every
correction carries who made it and when. A second correction of the same
question does not overwrite the first; the newest is shown and both are
kept.

### 49. A question nobody answered cannot be corrected

The correction sheet lists only questions with an answer in them. A skipped
or blank question has nothing to put right, and what the doctor learns when
he asks it himself is his own history-taking. That belongs in his notes at
milestone 9 — not written into the front desk's record of a conversation he
was not present at. The sheet says so in place of the boxes.

### 50. The correction sheet is in the order he just read

It stops the screen rather than squeezing into the intake column, and it
lists the questions in the same order the card does. The first version
listed them in whatever order the database returned, which put "allergies"
above the presenting complaint. A doctor hunting for the sentence he is
trying to correct is a doctor who corrects the wrong one.

### 51. The laptop says which chair it is speaking for

Only a doctor may confirm a history. Building that rule while every action
in the program is recorded as the same anonymous front desk user would make
it a decoration.

So the laptop now carries a role setting: doctor, clinical assistant, or
front desk. **It is not a login.** Nothing is proved, there is no password,
and the screen says exactly that. It defaults to the doctor because it is
the doctor's laptop. What it buys is a real rule with a real refusal
behind it — with the laptop set to the front desk, Confirm is dead and the
reason is written under the button rather than left to be guessed. Sign-in
proper arrives at milestone 9 and replaces this.

### 52. Any patient on the list can be opened, not only the one in the room

The card used to show whoever was in the chamber. Every row of today's list
now has a Card button, and C on the keyboard opens the highlighted one, so
the doctor can read a waiting patient's history before calling them in. The
open card re-reads itself every fifteen seconds, so a red flag raised at the
front desk while the patient is already sitting in the chamber appears
without anybody reopening anything.

---

## Milestone 9: sign-in, vitals and the consultation

### 53. The PIN is honest about what it protects

Signing in at a chamber is not signing in to a bank. The people doing it
are standing at a desk with a patient in front of them, twenty times an
evening, and a password long enough to resist a determined attacker would
be written on a sticky note by the second evening. A written-down password
is worse than a short one.

So it is a PIN, and what it does is stated plainly rather than implied:

- **What it protects:** the record of who did what. Mr Biplob cannot
  confirm a history as the doctor by walking up to the laptop, and a
  patient left alone in the chamber for a minute cannot read the previous
  patient's history.
- **What it does not protect:** the database. That is protected by the
  passphrase and by SQLCipher, and it is already unlocked by the time
  anybody signs in. Somebody who steals a running, unlocked laptop is not
  stopped by four digits and nothing here pretends otherwise.

The hash is scrypt with a per-user salt, so the stored value is useless to
somebody reading the database file, and two people who pick the same PIN do
not share a hash. `1234`, `0000` and a repeated digit are refused: the whole
point is that one person cannot act as another, and that fails completely
the moment the PIN is guessable by somebody standing next to them.

### 54. There is no automatic sign-out, deliberately

A screen that logs the doctor out mid-consultation, with a patient in front
of him and half an examination typed, is a screen that gets worked around
within a week — the PIN written on the desk, or the sign-out button avoided.
The laptop is in the doctor's own room and the database is encrypted; what
is being protected is the truth of "who wrote this", and a timer does not
help it. Closing the program signs everybody out, including every tablet.

### 55. The tablet asks who is holding it

Pairing says a tablet is allowed to talk to the laptop. It says nothing
about which assistant is using it, and that is what goes into the record
beside every answer a patient gives.

So each assistant signs in on the tablet once at the start of the evening.
The PIN is checked on the laptop and never leaves it; the tablet is sent
names and roles only. A tablet nobody has signed in on is refused, and
the refusal is in Bangla, because it is read by the person at the desk.

Nothing is lost when this happens: the tablet's buffer keeps everything
until somebody signs in, so a laptop restart in the middle of an evening
costs one sign-in and no data.

### 56. The front desk does not open the Recall Card

The line between the front desk and the two clinical roles is drawn twice,
for two different reasons.

**Writing** was already decided by your brief: a front desk user may run the
register and take the intake, and may not enter vitals, findings, a
diagnosis, a decision or a medicine. That is enforced in the data layer.

**Reading** is new here. The Recall Card is a consolidated view of
somebody's medical history — four years of diagnoses, medicines and results
— assembled for the person treating them. The desk needs to know who is
here, who is waiting and who is next, and the register and queue give them
all of it. In a chamber where the assistant lives in the same neighbourhood
as the patients, "does not need" is the whole argument.

So the card is refused in the data layer, and the button for it is not on
their screen at all. A button that refuses is a worse design than a button
that is not there.

### 57. A reading that looks wrong is questioned, never refused and never corrected

The plausibility ranges are deliberately far wider than any clinical normal
range: 50–300 for the upper blood pressure number, 20–250 for the pulse.
The only thing being caught is a typing mistake, and the value is stored
exactly as typed either way. Refusing to save what somebody actually typed
is how a reading ends up on a scrap of paper instead of in the record.

Every question is about the typing and never about the patient. "The lower
number is the same or bigger than the upper one — check whether they are the
right way round." Never "that is high". A test in the suite asserts that no
vitals question contains a word of interpretation.

### 58. Confirming a consultation is a signature, and the database enforces it

After the doctor confirms, the encounter and its prescription are locked by
SQLite triggers, not merely by the code around them. Changing a confirmed
consultation is still possible and sometimes necessary; it takes an undo
that is recorded, then the change, then a new confirmation. The audit log
ends up holding the whole sequence, which is the difference between an
amended record and a falsified one.

The text as it stood at the moment of signing is copied into the audit
entry, so what was signed stays readable even after an amendment.

Investigations are the one exception, and the exception matters: **which**
tests were ordered is part of the signed record and is frozen, but the
**result** comes back days or weeks later, long after the consultation was
confirmed. Recording it must never require undoing a signature on a
consultation that is finished, so the result columns stay open for ever.

### 59. Autosave, because the enemy is a power cut and not a change of mind

There is no Save button. Every box writes itself to the encrypted database
about a second after typing stops, and opening the screen creates the draft
row immediately, so a power cut thirty seconds into a consultation leaves a
row with the doctor's name on it rather than nothing at all.

Draft autosaves do not each write an audit entry — a draft is not yet a
record, and a hundred log rows per consultation would bury the entries that
matter. Vitals are different and every change to one is logged with what it
was and what it became: a blood pressure that changes after the fact is
exactly the sort of thing somebody may have to account for later.

### 60. The screen shows last time's medicines, and suggests nothing

"Continue the same medicine" is the commonest sentence in a chamber, and
retyping a dose from memory is how a dose changes by accident. So the
consultation screen carries last visit's diagnosis and prescription, with
one button that copies them in.

That is the only help this screen gives, and it is not clinical help: it is
a copy of what this doctor himself wrote before. There is no drug list, no
dose calculator, no interaction check, no diagnosis suggestion and no
autocomplete on any clinical field. Every word in the record is typed by a
person.

---

## Milestone 10: the prescription

### 61. The sheet has to stand on its own, because nothing else will be there

This is the only part of the system that leaves the chamber. It may be read
tonight by a pharmacist, next year by another doctor, or in an emergency by
a hospital — and none of them will have this software or any way to ask it a
question.

So the printed sheet carries, by itself: who prescribed and their BMDC
registration number, which chamber and its address, which patient with age
and sex, which day, the serial, the medicines with dose and duration, the
tests ordered, the advice, and the follow-up date. If the paper is all
anybody has, the paper is enough.

### 62. The letterhead is a file the doctor edits, and it ships full of placeholders

Same rule as the red flag rules and the consent wording. `prescription.yaml`
sits in the data folder beside the database, holds the doctor's own name,
degrees and registration number, and ships with every line reading
PLACEHOLDER.

**Against a real database the software refuses to print until they are
gone.** A prescription reading "PLACEHOLDER — DOCTOR'S NAME" in a patient's
hand is worse than no prescription at all. In the practice database it
prints anyway, with PRACTICE — NOT A REAL PRESCRIPTION across the sheet, so
the layout can be looked at and shown to people.

The file is read fresh on every print, so a correction takes editing one
line and pressing Print again. Nothing is restarted.

### 63. Nothing is printed before it is signed

Printing needs a confirmed consultation. The moment a sheet leaves the desk,
nobody can tell a draft from a signed record — not the patient, not the
pharmacist, not the doctor who sees it next year. So the signature comes
first, and the Print button says why while it is disabled.

Undoing a confirmation to amend a prescription that has already been printed
is allowed, recorded, and shows on the screen as a reprint.

### 64. Two things the doctor decides, not the software

The letterhead has two switches, because both are genuinely his call and
both affect a piece of paper other people will read:

- `print_diagnosis` — many chambers print the working diagnosis; some
  deliberately do not, because the patient shows the sheet to whoever they
  show it to.
- `print_vitals` — today's readings are useful to whoever sees the patient
  next, and are also information the patient carries around.

A reading nobody took is never printed as a dash. An empty box does not
become a measurement on a piece of paper.

### 65. What a "print" means in the record is stated honestly

A browser cannot tell a printed page from a cancelled print dialog. So the
audit entry records "the doctor pressed Print", counts the copy, and marks
anything after the first as a reprint — rather than claiming paper came out.
Reprints are worth counting: a reprint usually means something went wrong
with the first one, and that is a number the pilot report should show.

---

## The serial register moves to the tablet

Your brief put registration on the tablet from the beginning — "Interface A
… registers arrivals, assigns serials" — and milestones 4 and 5 built it on
the laptop instead. That was the wrong device: the laptop sits in the
chamber and the front desk cannot reach it. This puts it where the brief
said, and where the paper book it replaces actually sat.

### 66. The desk can now register, search and give a serial

Three things on the tablet, all two taps deep: find a returning patient by
phone or name, register somebody who has never been before, and give either
of them a number. The number itself fills the screen afterwards, because the
next thing that happens is somebody calling it out across a waiting room.

The laptop keeps its own copy of all three. One tablet with a flat battery
must not stop a chamber from working.

### 67. This is the one part of the tablet that cannot work offline, and it says so

Everything else the tablet does is buffered: the questions carry on
appearing with no wifi and go across when it returns. Registration cannot
work that way, and the reason is not laziness.

A serial number has to be unique and in order for the whole chamber. Two
tablets handing out number 14 out of their own buffers would put two
patients in one place in the queue, and there is no way to repair that
afterwards without taking a number off somebody. So these three calls go
straight to the laptop, and when they fail the screen says exactly that —
in Bangla, with what to check — rather than pretending to have succeeded.

### 68. The rules from the laptop screens carry over, and matter more here

The search always returns a LIST and never picks a patient by itself, however
sure it looks: two brothers on one phone number is normal here, and the
wrong pick puts one man's history under another man's name. "A new patient"
is on screen at every step, because the commonest thing at a front desk is
somebody who is not in the system yet, and making that the hard path is how
names get retyped into a search box until something matches.

A patient already on today's list is reported rather than silently added
twice, and the question is asked in the assistant's own language.

---

## Milestone 11: photographs of paper

### 69. The picture lives inside the encrypted database, not beside it

The original schema had a `file_path` column, meaning the photograph sat as
an ordinary file in the data folder. That was wrong twice over.

It would not have been encrypted. The database is SQLCipher; a JPEG next to
it is not. A photograph of a lab report has the patient's name across the
top and their results underneath, and leaving that readable to anybody
holding the laptop would undo the point of encrypting the records at all.

And a row and a file can come apart. A crash between the two writes, a
half-finished copy to a new laptop, somebody tidying the folder — each
leaves a record pointing at nothing, or a picture belonging to nobody.
Inside the database they are one write in one transaction and cannot
separate.

The cost is size, and it is worth stating plainly rather than discovering:
a downscaled photograph is about 300 KB, so this chamber adds roughly
100 MB over the twelve-week pilot and a few gigabytes over years. SQLite
carries that, and a backup stays what it should be — copy one folder. If a
much busier practice ever makes the file too heavy to copy, moving the
pictures out to separately encrypted files is a contained change. It is not
a problem this chamber has, and building for it now would be guessing.

### 70. A photograph is never altered, and never quietly disappears

It goes in once with a checksum, and every read checks it: a picture that
does not match what was stored is reported in a sentence rather than shown
as a grey box, because a doctor looking at a grey box would reasonably
assume the photograph was simply a bad one.

Removing one is a soft delete with a reason, and the bytes stay. The
commonest real use is a picture of the wrong patient's paper, and that has
to come off the record visibly, with a name against it, rather than by
disappearing.

The database enforces both: one trigger refuses a delete, another refuses
any attempt to swap the picture under a row.

### 71. Nothing is photographed for a patient who said no

The permission that covers keeping a history covers keeping a photograph of
their report. There is no separate consent for this and there should not
be — it would be a second question at a desk, about the same thing.

A patient who declined, or who has withdrawn, cannot have paper filed for
them, and the message tells the assistant to hand it back. What was already
filed before a withdrawal stays: it is a medical record, and destroying it
is the doctor's decision to document, not the side effect of a tap at a
front desk.

### 72. This is the one thing on the tablet that is not buffered

Everything else the tablet sends is a few hundred bytes of text and waits
happily in its outbox. Photographs cannot: a queue of them would fill the
tablet's storage and be dropped by the browser without anybody being told.

So each one goes straight out and says at once whether it was saved. A
failed one stays on screen with a Try again beside it, and the screen
carries a warning while any are unsent. This is survivable in a way losing
typed answers would not be, and the reason is worth saying: the paper is
still in the assistant's hand. It can simply be photographed again.

### 73. The tablet shrinks the picture before sending it

A tablet camera produces four megabytes. The long edge is brought down to
1600 pixels and saved as JPEG at 82% — small print on a lab report is still
readable, chamber wifi copes, and the records file grows by 300 KB rather
than 4 MB. If anything about that fails, the original is sent unchanged
rather than nothing at all.

### 74. No thumbnails, and no reading of what is in the picture

The list on the laptop shows what actually tells one sheet from another —
kind, the date written on the paper, who filed it — and the picture opens
when it is chosen. Thumbnails would mean storing a second copy of every
photograph, and loading forty full ones to draw a grid would make the
screen crawl on the laptop this runs on.

And nothing reads what is in these pictures. No text is extracted, nothing
is recognised, nothing is classified. It is a photograph of a piece of
paper, filed under a heading a person chose.

---

## Milestone 12: backups, and a patient's own copy

### 75. A copy nobody has ever opened is not a backup

So the copy is opened, integrity-checked, and its row counts compared with
the records it came from, before the program says a word about success. If
any of that fails it says plainly that files were copied but there is no
backup, and names the folder so the doctor can try a different stick.

This is the whole difference between a backup and a habit of copying files.
Everybody who has lost data had been copying files.

### 76. The date is on the main screen, and the card changes colour

A backup taken three months ago is a backup that has already failed. The
main screen says when the last one was, in days, and the card turns amber
after three and red after seven — and red before there has ever been one.

Nothing about a backup is technical. What makes it happen is being asked
every evening by the screen you already have open.

### 77. How the copy is taken, and why it is safe

The WAL is checkpointed into the database file and the file is copied byte
for byte. That is only safe if nothing writes in between, and nothing can:
better-sqlite3 is synchronous, and this whole program — including the
server the tablet talks to — runs on one thread. Between the checkpoint and
the end of the copy there is no point at which any other code runs.

A byte copy also means the backup can be checksummed against what was
written, which is what catches a USB stick that has quietly gone bad in a
drawer. "Check a backup" re-reads that checksum and says so.

### 78. The backup folder explains itself to somebody who has nothing

It carries HOW-TO-RESTORE.txt in plain words, because the person reading it
may have a dead laptop, no software, and no idea what any of this is. It
says what the folder is, that the stick is as sensitive as the laptop, that
nothing should be deleted, and that a lost passphrase AND a lost recovery
key mean the records cannot be opened by anybody — including whoever wrote
this software.

### 79. Restoring never deletes what is already there

The records that are being replaced are renamed aside and left on the disk,
and a broken backup is refused before anything is touched. A restore is
done in a hurry by somebody who has already lost something; it is the one
operation here that could destroy records rather than protect them.

### 80. The copy a patient can ask for, because we promised it

The consent wording says "you can ask for a copy of your information at any
time", and the Personal Data Protection Act requires it. A promise that
takes ten minutes at a busy desk is a promise that will not be kept, so it
is one screen and one button.

There are two forms, and they differ on purpose:

- **The file** is the complete record — everything held about them,
  including the front desk screening and every warning it raised, with the
  photographs of their own papers handed back as picture files. That is what
  the right of access means and it is answered in full.
- **The printed sheet** is a summary, and deliberately leaves the screening
  warnings off. A warning is an instruction to an assistant to fetch the
  doctor sooner; printing it for the patient turns it into a statement about
  how ill they are, which this software does not make. The sheet says on it
  that a complete copy can be given as a file, so nothing is hidden — it is
  put in the form where it means what it says.

The file is not encrypted, and the note inside it says so: it is theirs to
keep and to show to whoever they choose.

---

## Milestone 13: the pilot report

### 81. It counts, and it does not conclude

Somebody has to decide whether this carries on after twelve weeks. The one
thing the software must not do is argue for its own continuation, so there
is no score anywhere on this page, no verdict, and no sentence saying the
pilot went well.

The last section is six questions the page cannot answer — did the card
change what you did for anybody, did a warning ever bring somebody in
sooner, did a warning ever fire for something that did not matter, is the
desk slower than the book was, would anything have been missed without the
laptop, and what did you want to look up and could not find. Those are the
questions the decision actually turns on, and they are answered by a person
who was in the room.

### 82. Every number carries its denominator, and below twenty there is no percentage

"57%" out of seven cases is arithmetic pretending to be evidence. Under
twenty the report says "4 of 7" and no percentage at all; above it, the
percentage still carries the count beside it.

A twelve-week pilot in one chamber produces small numbers for most of what
matters, and a page of confident percentages built on them would be the
most misleading thing this project could produce.

### 83. What did not work is a section near the top, not a footnote

Intakes started and abandoned, visits nobody screened, consultations never
confirmed, patients never asked for permission, tests ordered and never
resulted, and flagged patients who left without being seen. Each carries a
sentence saying why it matters.

The last of those is the number this whole safety layer exists to keep at
zero, and it is labelled as the one to look at first. A report carrying
only good news is a report nobody should act on.

### 84. Broken out per person, which is why every row records who did it

An average across two assistants hides exactly the difference worth seeing.
In the practice data one asks nearly every question and one skips more than
half, and added together they look like a chamber doing reasonably well.
Side by side they look like two different jobs.

That is the reason the usage log has insisted on an actor since milestone 1.

### 85. The research export carries no free text at all

The consent asks a second, separate question, and the patients who said no
are simply not in the export. Neither is any prose. Not the complaint in
the patient's own words, not the examination, not the diagnosis, not a
note — writing in a chamber contains people's names whether anybody intends
it or not, and no amount of care at the moment of typing changes that. What
goes out is coded answers, rule identifiers, measurements, counts and dates.

It is called de-identified, not anonymous, and the note in the folder says
so: a visit date plus a small chamber can still point at one person. The
patient code is random per export and means nothing outside the file.

### 86. An age estimated on one day, asked about another

The report and the export both ask what somebody's age was at a visit, and
for a patient whose age is an estimate rather than a date of birth that can
be a visit BEFORE the estimate was taken. The age code refused to answer
backwards, which emptied a whole column of the first research export.

"45 today" means "43 two years ago" by the same arithmetic that makes it
mean "48 in three years". It now counts in both directions, and still
refuses to place somebody before they were born.

### 87. One installer, Windows only, unsigned

Windows 10 or newer, 64-bit, and nothing else. Not because macOS is hard,
but because narrow and reliable beats broad and fragile, and the chamber
laptop is a Windows laptop. A macOS or Linux target can be added the day
somebody actually needs one.

It is not code-signed. A certificate costs real money for a twelve-week
pilot and changes nothing about how the program behaves. The visible price
is one blue "Windows protected your PC" box the first time the installer
runs, which is written down in INSTALL-WINDOWS.md so that it is expected
rather than alarming. It is also the only warning of its kind the program
should ever produce, which makes any other one worth stopping for.

Nothing is compiled at packaging time. The encrypted database engine ships
ready-built for every platform inside its own package, so the Windows
installer can be produced on Linux — which is where it was produced, and
where it was then run and tested under wine: the database provisioned,
all ten migrations applied, SQLCipher confirmed to encrypt (the patient
text is not in the file), the wrong key refused, the append-only triggers
enforced, Bangla stored and read back, and the tablet server serving its
page over HTTP to a browser outside the emulation.

What that testing does NOT cover is the drawn window itself on real
Windows — the screens were looked at on Linux instead, which is the same
Chromium drawing the same bundle.

### 88. Uninstalling never deletes the records

`deleteAppDataOnUninstall: false`, and it is the one line in the packaging
configuration with a paragraph of comment above it.

The records, the key file, the rules and the consent wording live in the
data folder, not in the program folder. Removing the program leaves them
untouched, so that reinstalling or upgrading cannot cost a single patient's
history. Deleting the records has to be a deliberate act by somebody who
knows exactly which folder they are deleting.

### 89. A practice database you can fill from inside the program

The program can be shown to somebody before it has ever met a patient,
because an empty Recall Card demonstrates nothing and a demonstration on
real patients is not a thing to consider.

So the first-run screen offers to fill the practice database with three
hundred invented people and four years of invented visits. Two guards sit
inside `seedDatabase()` rather than beside the button, so that they hold
however it is called: it refuses a database marked live, and it refuses one
that already has patients in it. There is no path from that button to a
real record.

It asks nobody to sign in first. On a fresh installation nobody has been set
up yet, and this is the screen that gives them somebody to sign in as. What
makes it safe is not who asks but what it is allowed to touch.

### 91. The test runner is not allowed to be the thing that fails silently

Found by cloning this repository from scratch and running it, which is
worth doing more often than it is done.

`tests/database.test.ts` inserted an attachment row using `file_path`, a
column migration 10 removed when photographs moved inside the encrypted
database. The insert threw. It threw in the BODY of the group rather than
inside a test, and node's runner prints `not ok` for that and then reports
"fail 0" and exits 0.

So the group proving that twelve tables refuse a DELETE stopped running at
milestone 11 and said nothing about it. Every "593 checks pass" after that
was 593 of the checks that still ran.

The checks now go through `scripts/run-tests.js`, which fails when the
words "not ok" appear anywhere in the output. A blunt rule, deliberately:
this project's first rule is that nothing fails silently, and the thing
that checks that rule cannot be the exception to it.

`npm test` also builds the tablet page now. Three server checks needed it
and had been passing only on machines where a previous `npm start` had
left it lying around — green here, red on a clean clone, which is the
worst way round.

### 92. Line endings are LF everywhere, and a test edit that matches nothing is an error

The installer build on GitHub failed on its first three runs, and the
reason is worth writing down because it is the same shape as decision 91.

A check edits `consent.yaml` to remove the English half of one line, then
asserts that the file is refused for not being in both languages. It made
that edit with `String.replace`, searching for two lines of the file with
a `\n` between them. Git checks text out with CRLF on Windows, so the
search found nothing, `replace` returned the string unchanged, the check
went on to test the UNEDITED file, and the failure it reported was that a
rule had stopped working.

Nothing in that failure message points at line endings. It is a bad
failure: it accuses the product of a fault that is in the check.

Two fixes, because there are two faults.

`.gitattributes` now normalises every text file to LF in the repository
and in every working tree, on every platform. The config files here are
meant to be edited by hand on a Windows laptop, and editors there have
handled LF for twenty years.

And `tests/helpers.ts` grew `editing(text, find, replaceWith)`, which
throws when `find` is not in the text rather than returning the text
unchanged. Every check that edits a file on disk now goes through it.
`String.replace` failing to match is silent by design, which is fine for
a program and wrong for a test: a check that quietly examines the
original file can pass for the wrong reason just as easily as it can
fail for one.

### 93. A practice PIN is not a secret, so it stays on the screen

The four invented staff of a practice database were shown once, on the
screen that created the data, and never again. Somebody navigated past
that screen and was locked out of a database full of people who do not
exist. Reinstalling did not help, because uninstalling deliberately
leaves the records alone -- so the program came back to the same four
people and the same four PINs nobody could read.

The mistake was treating an invented person's PIN as though it were
worth hiding. It is not: it lives only in a database marked demo, which
can never hold a real patient, and it is written down in
INSTALL-WINDOWS.md anyway. Hiding it bought nothing and cost an evening.

The sign-in screen now prints each practice PIN beside the name. The
guard is `dataMode(db) === 'demo'`, checked in the main process rather
than trusted from the screen, so on a live database the code that
attaches a PIN does not run at all and there is no path by which a real
person's PIN reaches a renderer.

`PRACTICE_STAFF` is now one exported list that the seed builds its users
from and the screen reads its PINs from, with a check that the two have
not drifted apart -- because a screen confidently printing the wrong PIN
would be worse than the screen that printed none.

Compare decision 5, the recovery key, which is shown once and cannot be
recovered. That one is right: it protects real records, and the screen
makes you tick a box saying you wrote it down. The difference is what is
behind the door.

### 94. The spare key is a credential, not a fourth kind of person

Asked for: an administrator who can reset a forgotten PIN and reach
nothing else.

The obvious build is a fourth role in `app_user`. It is the wrong build.
Anybody in `app_user` can be picked at the sign-in screen and can
therefore become the author of something, and the entire point of this
account is that it writes nothing clinical and never appears beside a
patient's name. A role called "administrator" that must never author
anything is a row waiting to be selected by mistake.

So the spare key is not a person. It is a credential that opens ONE
screen with ONE button on it. There is nobody to sign in as, nothing to
select, and no row anywhere that can point at it as an author. It also
means no migration of the role CHECK constraint, and no rebuild of a
table that half the schema has foreign keys into.

Two things open it. THE RECOVERY KEY, which always works and needs no
setting up -- the chamber that most needs a spare key is the one that
never got round to making one, so the answer had to work out of the box.
And A SPARE CODE the doctor can set for whoever helps him with the
laptop, so the recovery key can stay in its envelope.

Neither is any use without the passphrase, because until that is typed
there is no database open to reset a PIN in.

### 95. A reset PIN is never a quiet event

Somebody holding the spare key can reset the doctor's PIN, sign in as
the doctor, and write in a record under his name. Four digits were never
going to prevent that, and decision 30 already says plainly what a PIN
protects and what it does not.

What the program CAN do is make it impossible for that to happen
quietly. Every reset goes to the audit log, naming which spare key was
used. And the person it happened to is told, on their own screen, until
they press "I knew about this" -- which is itself recorded, so that "I
was never told" and "I acknowledged it" are different things afterwards.

The notice travels with "who is signed in" rather than living on one
screen, because a notice in one place is a notice that gets missed.

Which spare key, not who held it: a shared code cannot honestly name a
person, and inventing an attribution would be worse than saying plainly
that it was the spare code.

### 96. The home screen opens on the evening, not on a menu

What was there: a page of cards, one of which had a button that opened
today's list. The list -- the thing the doctor came to the laptop for --
was below the fold, behind a click.

Today's list is now the home screen itself. Counts across the top, every
patient with Card, Call in, Left, Record and Seen on their own row, and
the panels underneath. The front desk sees the same list with the two
clinical buttons absent, which is decided in the data layer as well as
in the screen.

The list had to learn to be embedded to do this. It was written as
`position: fixed; inset: 0` -- it owned the window -- so dropping it
into a page made it float over the banner and the panels. It now takes
an `embedded` flag: flows in the page, and bounds its own scrolling so
that forty people waiting cannot push the panels out of reach.

### 97. What else is on that screen is the doctor's setting, not ours

He said he wanted to decide after using it rather than before, which is
the right way round, so it is a setting.

One rule governs it: TURNING SOMETHING OFF NEVER MAKES IT UNREACHABLE.
Everything not pinned is one tap away under "Everything else". The
setting decides what he sees without looking for it -- never what the
program can do. A settings screen that can hide the backup button
until the backup is a year old would be a settings screen that loses
records.

An empty choice is a real choice and is stored as one: a doctor who
wants nothing but the list gets nothing but the list. Only a genuinely
broken value -- unparseable, or not an array -- falls back to the
default, because the failure to avoid is a blank screen with no way
back. Unknown panel ids are dropped one at a time rather than
poisoning the whole setting, so an older installation meeting a newer
list of panels degrades instead of resetting.

One setting for the installation rather than one per person. There is
one doctor and one laptop, and a per-person version means a schema
change to answer a question nobody has asked.

### 98. A tablet belongs to one chamber, and that is what makes offline serials safe

The route that gives out serial numbers used to refuse to work offline,
and the comment said exactly why: two tablets handing out number 14 from
their own buffers would be worse than a tablet that says plainly it
cannot reach the laptop.

That reasoning was right and still is. What changed is not the reasoning
but the premise. A tablet is now bound to ONE chamber when it is paired,
and exactly one tablet sits at one desk, so there is no second buffer.
Biplob's tablet gives out Popular's numbers whatever chamber the laptop
is at -- which also fixed a quieter bug: the arrival route used to take
the LAPTOP's active chamber, so a tablet at Popular would have filed its
patients under Lubana.

The residual case is the laptop giving out a number for that chamber
while the tablet is away. Decision 99.

### 99. A patient who was told the wrong number hears it from a person

When an arrival lands and the number the desk announced has been taken,
the patient keeps their PLACE -- they were there first and their arrival
time proves it -- and takes the next free number.

The number they were told is written down beside it, and today's list
says so, in red, and does not stop saying so until somebody presses "I
have told them". A patient who was called four and is now five must hear
that from a person rather than discover it when somebody else is called.

Silently renumbering would have been three lines shorter.

### 100. One path, whether the laptop is there or not

The tablet always gives out its own number and always puts the arrival
in the outbox, even when the laptop is sitting right there. It would
have been easy to keep the old direct route for when the wifi is up and
use the new one only as a fallback.

That would have been worse. Code that only runs when the wifi drops is
code nobody has tried, and it would run for the first time on the worst
evening. Now the offline path is the ordinary path, exercised every time
anybody gives out a number, and the wifi being down changes nothing
except how long the outbox holds it.

### 101. An arrival carries its own author

The laptop remembers who is signed in on a tablet in memory only. The
doctor closes it at Lubana and opens it at Popular, and that memory is
gone -- exactly when two hours of buffered arrivals are trying to land.

So every arrival carries the id of the assistant who took it, checked
against app_user when it arrives, and that is what goes on the record.
The desk-arrival route is handled BEFORE the sign-in check for this
reason, and it is the only route that is. Turning that work away for
want of a live sign-in would throw away an evening somebody really did.

An arrival naming nobody is still refused. A record with no author
cannot be repaired afterwards.

### 102. What a tablet may hold, decided by the doctor and written down

Names and phone numbers, and nothing else: no diagnosis, no medicine, no
test, no previous visit, no reading, nothing anybody wrote. Enough to
tell a returning patient from a new one, which is the whole job.

This was raised as a cost before it was built -- a tablet holding
patient-identifying data is a notifiable thing to lose under the
Personal Data Protection Act -- and the answer came back that the cost
is worth the two hours it buys. It is his chamber and his call, and it
is recorded here as his.

The copy is encrypted under a key derived from the pairing token, and
disconnecting the tablet makes it permanently unreadable. Being precise:
that stops somebody reading the list off a tablet they picked up, and it
does not stop somebody who takes the device apart, because the key must
live on the tablet for the tablet to read its own list. A key beside the
lock is not a safe. See docs/TWO-CHAMBERS.md, which says so in the same
words to whoever runs the chamber.

### 103. The tablet never claims a history it cannot see

Found by looking at the screen. A patient found in the tablet's own list
was shown with "no previous visit" underneath -- because the offline
result had a visit count of zero, the count having never left the
laptop.

She had been three times. The screen was not missing information; it was
asserting something false, to an assistant who would read it as fact and
might register her again as somebody new.

It now says "their history is on the laptop", and drops the age line
too, which was making the same claim more quietly. Showing nothing is
always available. Showing something untrue is not.

### 104. The tablet's list is the whole register, and carries a last visit

Two corrections to decision 102, both from the doctor's side.

The directory is EVERY patient, not this chamber's. A woman seen at
Lubana in March walks into Popular in August; she is the same woman and
the same record, and the desk at Popular has to find her or it registers
her twice and the doctor opens a card with half her history on it.

And it carries the DATE she was last seen and WHICH chamber. Decision
103 removed a false "no previous visit" from the tablet because the
tablet could not know. The answer he chose was not to remove the line
but to let the tablet know: name, number, last seen, where. Still no
diagnosis, no medicine, no test, no reading, no word anybody wrote.

That is a wider thing to lose than names and numbers alone, and it was
his to widen.

### 105. The patient who came only to show a report

A large share of an evening is people the doctor sent for a test last
time, coming back with the paper. Asking them "what is troubling you
today, and for how long" is asking the wrong question, and the answers
are worse than useless: a screening full of "nothing" is
indistinguishable from a screening nobody took.

So the desk marks it once, before the number is given, and the questions
about a new complaint are not asked. What the desk does instead is
photograph the paper, which is what the patient came to hand over.

Three things it is NOT. It is not a lighter kind of patient: everything
a consultation can do, this can do. It does not switch off the rules --
somebody who says something alarming while handing over a report is
still moved up. And IT DOES NOT CHANGE ANYBODY'S PLACE IN THE QUEUE.
They are counted and marked and left exactly where they arrived, because
the doctor has not been asked yet whether he wants them interleaved.
There is a test whose whole job is to fail if that ordering ever changes
by accident.

### 106. The bell, and why it is a bell

The doctor finishes with a patient and the next one has to be walked in.
The desk found that out by looking at a list that refreshes every twenty
seconds, which is an age with a room full of people and no use at all if
nobody is looking.

The assistant is not watching the tablet. They are talking to somebody,
writing on a card, answering the phone. A message that only appears on
screen is a message nobody sees for two minutes, and two minutes is the
doctor sitting in an empty room. So it makes a noise, and it takes the
whole screen.

A separate endpoint, a few bytes, asked every three seconds, rather than
polling the whole session faster. And a fingerprint of the room rather
than a timestamp, so the bell rings on a CHANGE rather than every three
seconds.

Android refuses to let a page make a noise until it has been touched.
That cannot be argued with, so the sound is armed on the first touch of
the session -- which the assistant makes anyway signing in -- and when
it is not armed the screen SAYS SO rather than pretending it will be
heard.

### 107. Out of turn is worked out, not recorded, and ignores escalations

A patient is being seen out of turn when somebody AHEAD of them is still
waiting. Computed from queue_position at the moment of asking, so it
stays true if the doctor reorders the list afterwards.

Deliberately queue_position and not the serial number. A patient moved
up by a red flag rule has a low position and a high serial, and calling
them first is the system working exactly as designed. Announcing that as
irregular would teach the desk that the warning means nothing, which is
the one lesson this program must never teach.

### 90. There is still no way to start a real database, and that is the point

The program can only create a database marked demo. No screen anywhere
offers a live one.

Going live is gated behind three things only the doctor can do — the red
flag rules, the consent wording, the letterhead — and building the switch
before those exist would be building a way around them. The switch is the
next piece of work, and it belongs after the rules are written rather than
before.

---

## Two bugs from milestone 7

**The tablet crashed on the first tap after the update.** It keeps a copy of
the last session so it can work with no wifi. After the laptop's software
was updated that copy was the OLD shape, and code expecting the new consent
field walked into it — every tablet with a cached session simply stopped
responding when a patient was tapped. The cache now carries a shape number
and a cache from a different version is ignored rather than trusted. The
cost is one trip to the laptop after an update; the alternative is a tablet
that looks fine and does nothing.

**The patient list on the tablet was laid out wrongly the whole of milestone
6.** Name and age ran together on one line and the status pill stretched
across the row. I had screenshotted three tablet screens and not that one.
That is the third time in this project a screen I did not look at was
broken, which is a pattern rather than an accident: from here on the rule is
that every screen a milestone touches gets looked at, not a representative
sample of them.

---

## Three bugs from milestone 6, one of which the screenshots hid

**The application could not register a patient at all.** `patient.created_by`
is NOT NULL, and the running program was passing an actor with no id - so
every write from the front desk screen would have failed on the constraint.
It was found by a server test doing exactly what that screen does.

Everything I had shown you of milestone 4 was a *reading* screen. Search
worked, the merge preview worked, the screenshots looked right, and the one
path that writes was broken. The lesson I am taking from it: a screenshot of
a screen that reads proves nothing about the screen that writes, and tests
standing in for the application must use the same actor the application uses.
They now do.

The fix was not to relax the constraint. There are now real rows named
"Front desk (before sign-in was set up)", so records made before milestone 9
have a genuine author to point at and that author tells the truth about
itself.

**The server reported the wrong port.** Asked for "any free port" it returned
the number it had been asked for rather than the one it got, sending the
tablet to an address that could not exist.

**An older installation had no question file.** The template was written only
when creating a new installation, so an existing chamber opened with the
tablet having nothing at all to ask - the same shape as the migration bug in
milestone 5. Opening now writes it if it is missing, and only if it is
missing, so a doctor's own edits are never overwritten. The red flag rules
are deliberately NOT treated this way: a missing rules file means the safety
layer is gone, and quietly putting placeholders back would look like a
recovery when it is not.

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

### J. Attribution — ANSWERED, and built at milestone 9

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

**Milestone 8 narrowed this. Milestone 9 closed it.** Everybody who works
here now has an account and a PIN, and nothing clinical can be recorded
until at least one doctor exists. Every record written from the laptop or
the tablet carries the name of the person who wrote it. The paragraph above
described the state of things up to milestone 8; it no longer applies.

What remains before a real patient is the consent wording and the spoken
recording (see CONSENT.md), not attribution.

### K. Consent — ANSWERED, and built at milestone 7

See [CONSENT.md](CONSENT.md) for the legal reading and decisions 39-46 above
for the design. The remaining work is not mine:

1. The physician and a lawyer in Bangladesh read `consent.yaml` together and
   fill in `approved_by` and `approved_on`, and change the version so it is
   no longer marked a draft. **Until then a live chamber cannot take an
   intake at all.**
2. Somebody records the audio, in Bangla, reading those exact words.
3. The lawyer gives a position on three open points, all listed in
   CONSENT.md: erasure versus the duty to retain medical records; who may
   consent for a patient who cannot; and the basis for the minimum register
   entry when a patient declines.

### L. Android tablet — ANSWERED

Written up as [ANDROID-TABLET.md](ANDROID-TABLET.md): which tablet to buy,
pairing, Add to Home Screen, and turning on screen pinning with a PIN — the
step that actually locks the tablet to the intake. Fifteen minutes, once,
by hand. It also covers what to do if the tablet is lost, which is a
two-step answer and the second step is telling you, because unsent answers
on a lost tablet may be a reportable breach.
