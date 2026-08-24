# Installing Chamber Recall on the chamber laptop

Windows 10 or newer, 64-bit. Thirty minutes, once, and most of that is
reading the screen carefully at the one point where reading carefully
matters.

Nothing here needs the internet. The laptop can be offline for all of
it, and after this it should be.

---

## Before you start

- The laptop that will live in the chamber. Not a spare, not yours —
  the records will be on this machine and nowhere else.
- The installer file, `Chamber-Recall-Setup-0.1.0.exe`, about 108 MB.
  Copy it onto a USB stick and carry it over.
- Somewhere safe to put one printed sheet of paper. A locked drawer at
  home, not the drawer under the laptop.
- Fifteen minutes for the tablet afterwards, which is its own document:
  `docs/ANDROID-TABLET.md`.

---

## 1. Run the installer

Double-click `Chamber-Recall-Setup-0.1.0.exe`.

**Windows will show a blue box: "Windows protected your PC."** This is
expected. It appears because the installer has no code-signing
certificate, which costs money and would change nothing about how the
program behaves. Click **More info**, then **Run anyway**.

That is the only warning of its kind you should ever see. If a different
warning appears — a virus alert, a network permission request — stop and
say so, because this program has no business touching the network beyond
the chamber's own wifi.

Then:

- Windows asks for administrator permission. Say yes. It is installed
  once, for the whole laptop, so it cannot be half-removed by accident.
- It offers an install folder. `C:\Program Files\Chamber Recall` is
  fine. Change it only if you have a reason.
- It puts an icon on the desktop and in the Start menu.

## 2. The first run: choose a password

Open Chamber Recall from the desktop icon.

It asks for a password. **This password opens the patient records every
evening.** Eight characters at least; a short phrase you will actually
remember beats a short complicated word you will not.

Do not use the password to anything else. It is not an account, there is
nothing to reset, and nobody can look it up.

## 3. The first run: the recovery key — read this bit twice

The next screen shows a long key in the shape
`AVJC-JTTB-068K-7RWD-X5WS-Y50Z-BSM5-5QMR`.

**This is the only time it will ever be shown.** It is not stored
anywhere anybody can read it, including inside the program.

Write it down or print it. Put it somewhere that is not the chamber and
not this laptop. Then tick the box and continue.

What it is for: if the password is forgotten, this key is the only way
back into the records. If both are lost, every patient history is gone
permanently — not encrypted-and-recoverable-by-an-expert, gone. That is
the price of the records being genuinely private, and it is the right
trade, but it is only the right trade if this sheet exists.

The letters I, L, O and U are never used in the key, so a `0` is always
a zero and a `1` is always a one.

## 4. Fill it with practice patients

The next screen is "Who works here". Before adding anybody real, take
the amber option: **Fill this practice database**.

It writes 300 invented patients with four years of invented visits,
takes about ten seconds, and then shows you four people to sign in as:

| Sign in as | PIN |
| --- | --- |
| Dr. Ashraful Haque *(doctor)* | 4021 |
| Nusrat *(clinical assistant)* | 5390 |
| Jahid *(front desk)* | 6172 |
| Shopna *(front desk)* | 7483 |

Nobody in that database exists. An amber band across the top of every
screen says so and never goes away.

This is the database you show your cousin. An empty Recall Card
demonstrates nothing, and a demonstration on real patients is not
something to consider.

---

## Showing it to your cousin

Sit beside him with the laptop. An hour is plenty. Sign in as
**Dr. Ashraful Haque, PIN 4021** and go in this order.

**1. Today's list.** Open it. Patients with serial numbers, some
waiting, one or two moved to the top with a red mark against them. Let
him look at the ordering before you explain it.

**2. A Recall Card.** Open one for a patient who has been before. This
is the screen the whole thing exists for: the red flag first, then
today's history taken at the desk — walled off in brown and marked *not
verified* — then the last two visits, the tests ordered and never
resulted, the readings over time. Ask him to find the thing he would
want to know, and time how long it takes.

**3. Confirm, then correct.** Confirming takes the desk's history into
the record under his name. Correcting adds his wording beside the
assistant's without ever replacing it. Show him that the old wording is
still there afterwards.

**4. The chamber screen.** Type a consultation — complaint,
examination, a medicine, a test. Show him that temperature can be typed
in °F and converts as he types. Then confirm it, and show him that the
record locks and an amendment has to be recorded rather than a rewrite.

**5. The prescription.** Print it to PDF. It will refuse to print for a
real patient while the letterhead still has placeholders in it — show
him that refusal, because it is the shape of every refusal in the
program.

**6. The tablet, if you have one.** The front desk is a different
interface with a different job. Even without a tablet, a second browser
window pointed at the address the laptop shows will do.

### What to ask him

Write his answers down as he says them, in his words.

- Where did he look first on the Recall Card, and was the thing he
  wanted there?
- What is on that card that he does not need?
- What is missing that he would have to ask the patient for anyway?
- Are the intake questions the ones he would want asked at a desk, in
  that order, in that wording?
- The bits marked *not verified* — is that distinction drawn where he
  would draw it?
- Twenty seconds, honestly: is this faster than the file he keeps now,
  or slower?

### What not to ask

Do not ask whether he likes it. Ask what he would have to do differently
on a Tuesday evening with forty patients waiting. Everything useful is
in that answer.

---

## The three things only he can do

Nothing real happens until these are done, and none of them can be done
by anybody else. They are on the briefing sheet in full
(`docs/briefing/chamber-recall-briefing.pdf`); in short:

1. **Write the red flag rules.** The file ships full of placeholders and
   the program refuses to open a real patient database until a doctor
   has replaced them and signed the file.
2. **Approve the consent wording**, with a lawyer, in Bangla and
   English. The tablet asks nobody anything until this is settled.
3. **Fill in the prescription letterhead** — his name, degrees, BMDC
   number, the chamber addresses and hours.

---

## Where everything lives

The program is in `C:\Program Files\Chamber Recall`. The records are
somewhere else entirely:

```
C:\Users\<the Windows account>\AppData\Roaming\chamber-recall\data
```

In that one folder: the encrypted database, the key file, the red flag
rules, the intake questions, the consent wording, the prescription
letterhead. The program prints the exact path on its own status screen —
read it there rather than trusting this line.

Two consequences worth knowing:

- **Use one Windows account on that laptop.** The records belong to the
  Windows account that created them. The doctor, the assistant and the
  front desk tell themselves apart *inside* the program, with their own
  PINs — that is what the PINs are for. Two Windows accounts would mean
  two separate databases and half the history missing from each.
- **Uninstalling does not delete the records.** That is deliberate and
  it is the most important line in the packaging configuration.
  Reinstalling, or moving to a newer version, cannot cost a single
  patient's history. If you genuinely want the records gone, delete that
  folder by hand, knowing exactly what you are doing.

Back up to a USB stick from inside the program. It checkpoints the
database, copies it, and then *opens the copy and reads it back* before
telling you it worked.

---

## What is not possible yet

**The program can only create a practice database.** There is no button
anywhere that starts a real one, and that is on purpose: going live is
gated behind the three things above, and building the switch before the
rules exist would be building a way around them.

So the pilot cannot start from this installer alone. That step is the
next piece of work, and it should be done when the rules and the consent
wording are written, not before.

---

## Rebuilding the installer

For whoever maintains this. From a clone of the repository:

```
npm install
npm run dist:win
```

The installer appears in `release/`. It cross-builds: the encrypted
database engine ships ready-made for every platform inside its own
package, so no compiler is involved and the Windows installer can be
produced on Linux or macOS as well as on Windows. On Linux the NSIS step
needs `wine` installed, for one moment where it has to run the
uninstaller stub it just built.

Configuration is `electron-builder.yml`, commented line by line.

To run from source without packaging anything:

```
npm install
npm start          # builds and opens the program
npm test           # 597 checks
npm run seed -- --dir ./data/demo --passphrase practice
```
