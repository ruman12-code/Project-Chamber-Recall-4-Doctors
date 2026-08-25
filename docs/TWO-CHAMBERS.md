# Two chambers, one laptop

The doctor holds Popular and Lubana on the same evening. The laptop is
wherever he is. Patients arrive at the other chamber and wait.

This is how the front desk works during that gap, and what it costs.

---

## What the desk can do with no laptop in the room

- **Find a returning patient** by name or phone number.
- **Register somebody new** — name, mobile, age, sex.
- **Give out a serial number**, out loud, immediately.
- **Take the whole screening**, as before.
- **Photograph the paper** a patient brings, as before.

When the doctor arrives and opens the laptop on that chamber's wifi,
everything the desk did goes across in a few seconds, in the order it
happened, and today's list is there before he sits down.

- **Sign in**, with the attendant's own PIN, so their name goes on
  everything they take.

## Signing in, and what that costs

Biplob taps his name and types his PIN. The laptop is asked first, every
time; when it answers, that is the sign-in and nothing else happens.

When the laptop **cannot be reached** — which is the whole point of this
page — the tablet checks the PIN itself and opens. The screen says so,
in a band across the top, for as long as it lasts.

This is worth setting out honestly, because it is the one place where
something about a PIN leaves the laptop.

**What the tablet is given.** For **front desk people only**, a second
verifier for their PIN, in a form a browser can compute. Not the PIN.
Not the value the laptop signs people in with. The doctor's PIN and the
clinical assistant's PIN are never given to any tablet at all.

**What it is worth to somebody who steals the tablet.** They could, with
the device taken apart and a lot of patience, work out a front desk PIN.
Deliberately slow arithmetic makes that hours rather than seconds, and
five wrong tries stop the tablet opening itself at all until it has
reached the laptop again. What they would then have is a screen that
asks a patient screening questions. Not the records — those are on the
laptop, behind the passphrase. Not anybody's history — no tablet ever
holds any. Not the ability to write anything into the record: the laptop
still checks the real PIN before it accepts a single line, so a tablet
opened this way has nothing accepted until somebody signs in for real.

**What actually protects a lost tablet** is the same as it has always
been: disconnect it on the laptop. That clears the pairing, and every
one of these verifiers goes with it, permanently.

**Three things have to be true for this to be worth it**, and they are:
the tablet has a screen lock of its own; it is pinned to this one app
(step 6 of the tablet setup); and a lost tablet is disconnected the same
day. Without those, do not use this — sign in with the laptop present
each morning instead.

**One thing to know about upgrading.** A PIN set by a version of this
program from before this existed has no such verifier, so the tablet
cannot open for that person on its own. It says so on their name, and
names them at the bottom of the sign-in screen. The doctor setting their
PIN again on the laptop is the whole fix.

---

## What is on the tablet, and what is not

| On the tablet | Never on the tablet |
| --- | --- |
| Every patient's **name and phone number** | Any diagnosis, medicine, test or note |
| The questions, and the red flag rules | Any previous visit, date or reading |
| Today's arrivals it has taken and not yet sent | Any PIN, in any form, for the doctor or the assistant |
| A way to check the **front desk's** PIN when the laptop is away | The value the laptop itself signs anybody in with |
| Which chamber it sits at | The records, in any form |

The list of names is **encrypted** on the tablet, and disconnecting the
tablet on the laptop makes it permanently unreadable.

Being precise about what that encryption does: it stops the list being
read by somebody who picks the tablet up and looks through its storage.
It does **not** stop somebody who takes the device apart properly,
because the key has to live on the tablet for the tablet to read its own
list. A key kept beside the lock is not a safe.

**A lost tablet is still a reportable event** under the Personal Data
Protection Act, because names and phone numbers are personal data. It is
a far smaller event than a lost history, which is why the trade was
made — but it is not nothing, and the answer is the same as before:
disconnect it on the laptop, and tell the doctor the same day.

---

## Serial numbers

A serial has to be unique and in order for one chamber on one evening.
The old code would not give one out without the laptop, and said why:
two tablets handing out number 14 from their own buffers would be worse
than a tablet that says it cannot reach the laptop.

That reasoning still holds. What makes it safe now:

**A tablet belongs to one chamber.** It is bound when it is paired,
shown on the laptop, and changed only there. Biplob's tablet gives out
Popular's numbers whatever chamber the laptop is at. Exactly one tablet
sits at one desk, so there is no second buffer to collide with.

**The laptop's count always wins** when the two can talk. The tablet
carries on from the last number the laptop knew about, and its own count
is only ever used to keep going from there.

### When a number cannot be kept

One case remains: the doctor adds a walk-in from the laptop, at that
chamber, while the tablet is away holding an arrival it has already
called by that number.

When that arrival lands, the patient **keeps their place** — they were
there first and their arrival time proves it — and takes the next free
number. Today's list then shows, in red, and does not stop showing:

> **Rahima Begum** was told **serial 4** at the desk, and that number was
> already used here. They are now **serial 5** and have kept their place
> in the order. **Tell them their new number.**

It clears when somebody presses *I have told them*. A patient who was
called four and is now five has to hear that from a person.

---

## Setting it up

1. On the laptop, open **The front desk tablet**.
2. Under the pairing code, set **The next tablet paired sits at** to the
   right chamber.
3. Pair the tablet as usual.
4. Check the **At which desk** column afterwards. It can be changed
   there at any time if a tablet moves.

With only one chamber in the installation there is nothing to set: the
tablet belongs to it.

---

## What is written down about all this

Every arrival taken at the desk is recorded as `visit_registered_at_desk`
in the audit log, carrying the number announced, the number given, when
the patient actually arrived, and **the assistant who took it** — not
whoever happened to be signed in on the laptop hours later when it
finally arrived.
