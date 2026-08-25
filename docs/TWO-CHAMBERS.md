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

## What it still needs the laptop for, once

**Signing in.** Biplob taps his name and types his PIN, and that is
checked on the laptop. The PIN itself never reaches the tablet, and it
never will: a four-digit PIN sitting on a tablet in a waiting room would
be guessable in seconds.

So the tablet has to see the laptop **once** — at the start of the day,
or the evening before — and after that it works alone. In practice the
doctor passes through, or the tablet is signed in before he leaves.

If nobody has signed in and the laptop cannot be reached, the desk
cannot give out numbers, and it says so plainly rather than recording
work against nobody.

---

## What is on the tablet, and what is not

| On the tablet | Never on the tablet |
| --- | --- |
| Every patient's **name and phone number** | Any diagnosis, medicine, test or note |
| The questions, and the red flag rules | Any previous visit, date or reading |
| Today's arrivals it has taken and not yet sent | Anybody's PIN, or anything to sign in with |
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
