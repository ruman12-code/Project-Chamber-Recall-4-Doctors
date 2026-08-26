# Setting up the Android tablet

Done once, by hand, when the tablet is first set up. Fifteen minutes.

The page itself cannot lock a tablet down — that is the tablet's own
operating system. Without these steps the front desk keeps a back
button and a browser bar, and somebody eventually taps out of the intake
in the middle of a patient.

---

## 1. Buy the right sort of tablet

- **10 inches or bigger.** The questions are deliberately large and one
  to a screen; on an 8-inch tablet the three-point scale gets cramped.
- **Android 12 or newer**, so screen pinning is present.
- **Wifi only is fine.** There is no SIM and no internet. It never needs
  to leave the chamber.
- Cheap is fine. This runs a web page.

## 2. Join the chamber's wifi

The same network the laptop is on. Nothing else is needed — no account,
no Google sign-in for the app to work, no Play Store download.

## 3. Open the address the laptop shows

The laptop screen shows something like `http://192.168.0.14:8137`. Type
it into Chrome on the tablet.

If the page does not load: the laptop and the tablet are on different
networks. A phone hotspot on one of them is the usual reason.

## 4. Pair the tablet

The laptop shows a six-character code. Type it in once. The tablet
remembers, and does not ask again.

If somebody has been trying codes and pairing has locked, close the
program on the laptop and open it again.

## 5. Add it to the home screen

In Chrome: menu (⋮) → **Add to Home screen**.

Open it from that icon from then on, not from Chrome. It opens without
the address bar, which is most of what "kiosk" means in practice.

## 6. Turn on screen pinning

This is the step that actually locks the tablet to the intake.

**Settings → Security → More security settings → App pinning** — turn
it on. Also turn on **"Ask for PIN before unpinning"**.

The exact path moves between Android versions and manufacturers. Search
the tablet's own Settings for **"pinning"** if it is not where this says.

Then, with the intake open:

1. Swipe up and hold, to show the recent apps.
2. Tap the app's icon at the top of its card.
3. Tap **Pin**.

The tablet is now stuck on the intake. To get out, hold **Back and
Overview together**, then enter the PIN.

**Set that PIN to something the assistant knows and the patients do
not.** It is the only thing stopping a waiting patient wandering out of
the app and into the browser.

### Three different PINs, and none of them is the same one

It is worth being clear about this, because they get confused:

| | What it opens | Who sets it |
| --- | --- | --- |
| **The tablet's lock screen** | The tablet itself, after it sleeps | Whoever sets the tablet up |
| **The unpinning PIN** | Getting out of this app, on this tablet | Same, in step 6 above |
| **Biplob's Chamber Recall PIN** | The intake, under his own name | The doctor, on the laptop |

The first two are Android's and are the same for everybody at that desk.
The third is personal: it is what puts a name against every answer a
patient gives, and two people at the same desk must never share one.

**Turn the tablet's own lock screen on.** It is not optional. Everything
on the page about signing in without the laptop — see
[TWO-CHAMBERS.md](TWO-CHAMBERS.md) — assumes the device itself is
locked when it is put down.

## 6a. Leave the page open

The tablet's screen comes from the laptop. Once it has loaded it keeps
working if the laptop leaves the room, but it cannot **load** without
it — so closing the tab, restarting the tablet, or the pinned app being
killed all leave Chrome's grey "This site can't be reached" until the
laptop is back.

So: open it while the laptop is on, pin it, and leave it. See
[TWO-CHAMBERS.md](TWO-CHAMBERS.md) for what is being done about this.

## 7. Settings worth changing while you are there

- **Screen timeout: 10 minutes.** Shorter and the assistant is
  constantly waking it; longer and it sits unlocked all evening.
- **Auto-rotate: off, locked to landscape.** The questions are laid out
  for landscape.
- **Automatic updates: off, or on wifi only.** A Chrome update
  mid-evening is not wanted, and there is no internet anyway.
- **Do not sign into a personal Google account.** This tablet holds
  patient answers in its buffer when the wifi drops. It should not be
  somebody's personal device.

## What happens if the tablet is lost or stolen

The tablet does **not** hold patient records. It holds:

- the questions and the red flag rules, which are not confidential;
- its pairing token;
- anything not yet sent to the laptop, which is usually nothing and at
  most one patient's answers;
- the names and phone numbers of patients, encrypted, so the desk can
  tell a returning patient from a new one with the laptop away;
- a way to check the **front desk's** PINs when the laptop cannot be
  reached — never the doctor's, never the assistant's. See
  [TWO-CHAMBERS.md](TWO-CHAMBERS.md) for exactly what that is worth to
  somebody who steals the tablet, which is less than it sounds and more
  than nothing.

Disconnecting the tablet on the laptop destroys the last two along with
the token. That is why it is step one.

Two things to do, in order:

1. On the laptop, **Disconnect** that tablet in the front desk tablet
   panel. Its token stops working at once.
2. Tell the doctor, because if it had unsent answers on it that is
   potentially a reportable data breach under the Personal Data
   Protection Act. See `docs/CONSENT.md`.
