# Running it the way a developer does

Everything below has been run from a clean clone of this repository —
downloaded fresh, installed, checked, opened — so the commands are the
ones that actually work rather than the ones that ought to.

---

## First, the honest answer about GitHub

**You cannot run this program inside GitHub, and you should not want to.**

GitHub can hold the code and it can build the installer for you. It
cannot run the program, for two reasons:

1. This is a desktop program with a window. GitHub's machines have no
   screen. There are tricks for piping a Linux desktop into a browser
   tab, and they would work, and the result would be slow, awkward to
   print from, and useless for a tablet on the chamber's wifi.

2. The more important one. This program's whole design is that patient
   records never leave one laptop. Running it on somebody else's
   computer in another country is the exact opposite of that. With
   practice data it would harm nobody — but it teaches the wrong habit
   to the person who will later run the real thing, and habits are what
   survive after the software is handed over.

So GitHub does two jobs here, and they are both worth having:

- **It builds the installer.** Repository → **Actions** tab → **Windows
  installer** on the left → **Run workflow** (choose the branch
  `claude/vibrant-albattani-sun7ue`). About four minutes later, open the
  run and scroll to the bottom: under **Artifacts** there is
  **Chamber-Recall-Setup-windows**.

  It downloads as a **.zip** — GitHub wraps every artifact that way, so
  this is expected. Right-click it → **Extract All**, and inside is
  `Chamber-Recall-Setup-0.1.0.exe`, which is the installer. It stays
  available for thirty days; after that, press the button again.

  The run does `npm ci`, all 610 checks, and the typecheck before it
  builds anything, so a red run means no file — a broken build never
  becomes something somebody carries to a chamber on a USB stick.
- **It keeps the code**, so any change you and your cousin decide on can
  be made, checked, and turned into a new installer.

To *run* it, the code has to come down onto a real computer. That is the
rest of this document.

---

## What you need

- A computer — the chamber laptop, or your own. Windows, macOS or Linux.
- **Node.js 22 or newer.** From [nodejs.org](https://nodejs.org), the
  button marked LTS. Accept every default.
- About 500 MB of disk, and ten minutes the first time.

You do **not** need Visual Studio, build tools, Python, or a compiler.
Nothing in this project compiles native code — the encrypted-database
engine arrives ready-built — which is why this is a short document
rather than a long one.

To check Node arrived, open a terminal and type `node -v`. It should
print something like `v22.14.0`. On Windows the terminal is **Command
Prompt**: press the Windows key, type `cmd`, press Enter.

---

## Getting the code

Two ways. The first needs nothing else installed.

### The simple way: download it

1. Open the repository on github.com.
2. Make sure the branch selector (top left, above the file list) says
   `claude/vibrant-albattani-sun7ue`.
3. Green **Code** button → **Download ZIP**.
4. Right-click the downloaded file → **Extract All**. Put it somewhere
   with a short path and no spaces — `C:\chamber-recall` is ideal.

### The developer's way: clone it

Needs Git from [git-scm.com](https://git-scm.com) (accept the defaults).
Then, in a terminal:

```
git clone https://github.com/ruman12-code/Project-Chamber-Recall-4-Doctors.git
cd Project-Chamber-Recall-4-Doctors
git checkout claude/vibrant-albattani-sun7ue
```

The difference that matters: with a clone, `git pull` brings down later
changes in one command. With a ZIP you download the whole thing again.

---

## Running it

Open a terminal **in that folder**. On Windows the easy way is to open
the folder in File Explorer, click the address bar, type `cmd`, and
press Enter.

Then three commands, in order.

```
npm install
```

Downloads everything the program depends on. A minute or so, and a wall
of text. It ends by saying how many packages it added; warnings about
"deprecated" packages are normal and harmless. **It should say
`found 0 vulnerabilities`.**

```
npm test
```

Runs 610 checks: that the encryption works, that the wrong password is
refused, that no clinical record can be deleted, that a skipped question
never quietly means "no", that the tablet's offline buffer loses
nothing. Half a minute. It should end with `# pass 610` and `# fail 0`.

If anything says `not ok`, stop and report it. The checks are wired so
that they cannot pass quietly when something is broken — that took
fixing once already.

```
npm start
```

Builds the program and opens it. The first time it shows **Set up
Chamber Recall**.

From here it behaves exactly like the installed version: choose a
password, write down the recovery key, and press **Fill this practice
database**. The first-run steps are written out properly in
[INSTALL-WINDOWS.md](INSTALL-WINDOWS.md), and the running order for
sitting down with your cousin is in there too.

To close it, close the window. To open it again, `npm start` again.

### Where it keeps the records

Running from source uses the same folder the installed program does:

```
Windows   C:\Users\<you>\AppData\Roaming\chamber-recall\data
macOS     ~/Library/Application Support/chamber-recall/data
Linux     ~/.config/chamber-recall/data
```

The program prints the exact path in the terminal when it starts, and
shows it on its own status screen. Read it there rather than trusting
this list.

To keep a second practice database somewhere else — useful if you want
one to break and one to keep:

```
CHAMBER_RECALL_DATA_DIR=./data/scratch npm start
```

On Windows Command Prompt that line is:

```
set CHAMBER_RECALL_DATA_DIR=.\data\scratch
npm start
```

---

## Which one should you use?

**Use the installer** to show your cousin. It is one file, it needs
nothing installed, it makes a desktop icon, and none of the session is
spent explaining what a terminal is.

**Use the source** when you want to change something he asked for.

---

## Changing what he asks you to change

Most of what a doctor wants changed after an hour with the program is
not code. Four files hold it, all in `config/`, all plain text, all
written to be edited by hand:

| File | What it decides |
| --- | --- |
| `questions.yaml` | The questions the front desk asks, their wording in Bangla and English, and their order |
| `red_flags.yaml` | The screening rules — which answers move somebody up the queue |
| `prescription.yaml` | The letterhead: his name, degrees, BMDC number, chamber addresses and hours |
| `consent.yaml` | What the patient is told before anything is recorded |

**Important, and easy to get wrong.** The copies in `config/` are the
templates used when a database is first created. Once an installation
exists, the live copies are the ones **in the data folder**, beside the
database. Editing `config/` after that changes nothing on that laptop.

So:

- Changing them for an installation that already exists → edit the copies
  in the data folder. The program reads them fresh each time it starts.
- Changing them for everybody, permanently → edit `config/` here, commit,
  and every new installation gets them.

Usually you want both: edit the data folder that evening so he can see
it, then copy the change back into `config/` so it is not lost.

After editing any of them, close the program and open it again. A file
with a mistake in it is **rejected with the line number** rather than
loaded with the broken rule quietly switched off.

For anything that is not in those four files — a column on the Recall
Card, the order of the screens, a word in the software itself — write
down exactly what he said, in his words, and bring it back. Those are
code changes.

---

## When something goes wrong

**`npm` is not recognised** — Node did not install, or the terminal was
open before you installed it. Close the terminal, open a new one.

**`npm install` fails with network errors** — retry it. It is the only
step that needs the internet, and it only needs it once.

**A check fails** — do not carry on to `npm start` and do not build an
installer. A failing check on this project means something that is meant
to be impossible is currently possible. Report it with the lines that
said `not ok`.

**The program opens to a password screen you do not know** — it found an
existing installation. That is the real one; do not guess at it. Use
`CHAMBER_RECALL_DATA_DIR` to point at a scratch folder instead.

**The tablet cannot reach the laptop** — they are on different networks.
A phone hotspot on one of them is the usual reason. Windows Firewall
will also ask, once, whether to allow the program on the network: say
yes for **Private** networks and no for Public.
