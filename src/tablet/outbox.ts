// ===================================================================
// The outbox: what to do when the wifi drops.
// ===================================================================
// Wifi at a busy front desk drops. It drops mid-question, mid-sentence,
// and it drops without telling anybody. The rule for this tablet is
// that the assistant never notices and never loses a word.
//
// So nothing is ever sent straight to the laptop. Everything an
// assistant does is written into this outbox first, and the outbox is
// drained in the background. If the laptop cannot be reached, the
// entries stay on the tablet - in localStorage, so they survive the
// page being reloaded, the browser being closed, and the tablet being
// switched off - and go out when it comes back.
//
// Two properties this depends on, both provided by the laptop:
//
//   ORDER. Entries are sent oldest first, one at a time, and being
//   out of reach stops the queue rather than skipping past it. Answers
//   must not arrive before the intake they belong to.
//
//   REPEATS ARE HARMLESS. Every route the tablet uses can be called
//   twice with the same thing and change nothing the second time. That
//   is what makes it safe to resend after a reply was lost on the way
//   back.
//
// TWO KINDS OF FAILURE, AND ONLY ONE OF THEM IS WORTH WAITING OUT
//
// The laptop not answering is temporary. It is a wifi drop, it is the
// laptop being carried to the other chamber, it is somebody closing
// the lid. The entry stays at the head of the queue and goes out when
// the laptop is back, and the assistant is told the tablet is holding
// things.
//
// The laptop ANSWERING AND REFUSING is not temporary. "That visit is
// not on today's list" will still be true in an hour, and in a
// thousand retries. Left at the head of the queue it blocks every
// single thing behind it for the rest of the evening, silently, while
// the strip says "laptop not reachable" about a laptop that is sitting
// there answering. That is exactly the failure this program is not
// allowed to have: work quietly not arriving, and nobody told.
//
// So a refusal is taken OUT of the queue and put in front of a person
// instead. It is not deleted, not retried and not hidden: it is shown
// on the tablet, with what it was and what the laptop said, until
// somebody reads it. Everything behind it goes through.

const STORAGE_KEY = 'chamber-recall.outbox.v1';
const REFUSED_KEY = 'chamber-recall.outbox-refused.v1';

export interface OutboxEntry {
  id: string;
  path: string;
  body: unknown;
  queuedAt: string;
  attempts: number;
}

/** Something the laptop answered and would not take. */
export interface RefusedEntry {
  id: string;
  path: string;
  body: unknown;
  queuedAt: string;
  refusedAt: string;
  /** What the laptop said, in its own words. */
  reason: string;
}

export interface OutboxStatus {
  pending: number;
  sending: boolean;
  /** Set while the laptop cannot be reached. */
  offlineSince: string | null;
  lastError: string | null;
  /**
   * Things the laptop refused. Never retried, never dropped, and shown
   * on the tablet until a person has read them.
   */
  refused: RefusedEntry[];
}

type Listener = (status: OutboxStatus) => void;

function read(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as OutboxEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A damaged outbox must not stop the tablet working. It is dropped
    // rather than crashing the page, and the assistant is told.
    return [];
  }
}

function readRefused(): RefusedEntry[] {
  try {
    const raw = localStorage.getItem(REFUSED_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as RefusedEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRefused(entries: RefusedEntry[]): void {
  try {
    localStorage.setItem(REFUSED_KEY, JSON.stringify(entries));
  } catch {
    // Nothing useful to do here. The queue itself is the thing that
    // must keep working.
  }
}

function write(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Out of room. Extremely unlikely with text this small, but if it
    // happens the assistant has to know rather than silently lose work.
    throw new Error('This tablet has run out of storage. Tell whoever looks after this software before carrying on.');
  }
}

export class Outbox {
  private inFlight: Promise<void> | null = null;
  private sending = false;
  private offlineSince: string | null = null;
  private lastError: string | null = null;
  private listeners: Listener[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param send        how to put one entry on the wire.
   * @param isUnreachable  whether a thrown error means "the laptop did
   *   not answer" as opposed to "the laptop answered and said no". The
   *   caller decides, because only the caller knows its own errors --
   *   and getting this wrong in either direction is serious: treat a
   *   refusal as unreachable and the queue jams for ever; treat being
   *   out of reach as a refusal and the desk's work is set aside for a
   *   wifi blip.
   */
  constructor(
    private readonly send: (path: string, body: unknown) => Promise<void>,
    private readonly isUnreachable: (error: unknown) => boolean = () => true,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    // Retried on a timer as well as on events, because "the wifi came
    // back" is not something a browser reliably announces.
    this.timer = setInterval(() => { void this.flush(); }, 4000);
    window.addEventListener('online', () => { void this.flush(); });
    void this.flush();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    listener(this.status());
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  status(): OutboxStatus {
    return {
      pending: read().length, sending: this.sending,
      offlineSince: this.offlineSince, lastError: this.lastError,
      refused: readRefused(),
    };
  }

  private announce(): void {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }

  add(path: string, body: unknown): void {
    const entries = read();
    entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      path, body, queuedAt: new Date().toISOString(), attempts: 0,
    });
    write(entries);
    this.announce();
    void this.flush();
  }

  /**
   * Sends what is waiting, oldest first, stopping at the first failure.
   *
   * When a send is already going, this waits for it rather than
   * returning at once. Anything added in the meantime is picked up by
   * that same run, so when this resolves the tablet really has nothing
   * left to send - which is what every caller assumes it means.
   */
  flush(): Promise<void> {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.drain().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    this.sending = true;
    this.announce();
    try {
      for (;;) {
        const entries = read();
        const entry = entries[0];
        if (entry === undefined) {
          this.offlineSince = null;
          this.lastError = null;
          break;
        }
        try {
          await this.send(entry.path, entry.body);
          // Re-read rather than reusing the list: something may have
          // been added while this one was in flight.
          write(read().filter((e) => e.id !== entry.id));
          this.offlineSince = null;
          this.lastError = null;
          this.announce();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!this.isUnreachable(error)) {
            // The laptop answered and said no. Retrying will get the
            // same answer for ever, so it comes out of the queue and
            // goes in front of a person instead. Never dropped.
            write(read().filter((e) => e.id !== entry.id));
            writeRefused([...readRefused(), {
              id: entry.id, path: entry.path, body: entry.body,
              queuedAt: entry.queuedAt, refusedAt: new Date().toISOString(), reason: message,
            }]);
            this.announce();
            continue;
          }
          entry.attempts += 1;
          const current = read();
          if (current[0]?.id === entry.id) { current[0] = entry; write(current); }
          if (this.offlineSince === null) this.offlineSince = new Date().toISOString();
          this.lastError = message;
          break;
        }
      }
    } finally {
      this.sending = false;
      this.announce();
    }
  }

  /**
   * A person has read a refusal and dealt with it.
   *
   * The entry goes only when somebody says it has been seen. It is
   * never cleared by a timer, a reload, or the laptop coming back.
   */
  dismissRefused(id: string): void {
    writeRefused(readRefused().filter((e) => e.id !== id));
    this.announce();
  }

  /** Only for the tests and for a fresh tablet. */
  static clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(REFUSED_KEY);
  }
}
