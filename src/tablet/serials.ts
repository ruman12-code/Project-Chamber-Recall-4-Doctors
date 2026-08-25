// ===================================================================
// Serial numbers, given out at the desk with no laptop in the room.
// ===================================================================
// The old code refused to do this, and said why:
//
//   "A serial number has to be unique and in order for the whole
//    chamber, and two tablets handing out number 14 from their own
//    buffers would be worse than a tablet that says plainly it cannot
//    reach the laptop."
//
// That reasoning still holds. What makes it safe now is that a tablet
// belongs to ONE chamber and exactly one tablet sits at that desk, so
// there is no second buffer to collide with.
//
// The count is per chamber and per DAY, and it resets when the date
// changes, because that is how the register works: patient one arrives
// again every evening.
//
// Whenever the laptop is reachable it says where the register has
// actually got to, and that always wins. The tablet's own count is only
// ever used to carry on from the last thing the laptop knew.
const STORAGE_KEY = 'chamber-recall.serials.v1';

interface Counter {
  chamberId: string;
  visitDate: string;
  next: number;
}

function read(): Counter | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Counter;
    return typeof parsed?.next === 'number' && typeof parsed?.chamberId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function write(counter: Counter): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counter));
  } catch { /* the number was still said out loud; losing the count is not worth stopping for */ }
}

/**
 * The laptop has spoken. Its number is the truth, and the tablet's own
 * count moves to it -- forward or back. Back matters: a tablet that
 * kept a stale higher count would leave gaps in the register forever.
 */
export function syncFromLaptop(chamberId: string, visitDate: string, nextSerial: number): void {
  write({ chamberId, visitDate, next: nextSerial });
}

/**
 * The next number to say out loud, when the laptop cannot be asked.
 *
 * A tablet that has never heard from the laptop about this chamber on
 * this day starts at one, which is right: an empty register starts at
 * one, and the laptop will correct it the moment it is reachable.
 */
export function takeSerial(chamberId: string, visitDate: string): number {
  const current = read();
  const usable = current !== null && current.chamberId === chamberId && current.visitDate === visitDate;
  const next = usable ? current.next : 1;
  write({ chamberId, visitDate, next: next + 1 });
  return next;
}

/** What would be given out next, without taking it. For the screen. */
export function peekSerial(chamberId: string, visitDate: string): number {
  const current = read();
  const usable = current !== null && current.chamberId === chamberId && current.visitDate === visitDate;
  return usable ? current.next : 1;
}

export function forgetSerials(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* nothing useful to do */ }
}
