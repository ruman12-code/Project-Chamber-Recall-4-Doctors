// ===================================================================
// Letting a tablet in, and keeping everything else out.
// ===================================================================
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/open';
import { newId } from '../db/ids';
import { nowIso } from '../db/clock';
import { recordAudit } from '../db/audit';

/** Same alphabet as the recovery key: no I, L, O or U to mis-read. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * The short code shown on the laptop and typed into the tablet once.
 *
 * A new one is made every time the program starts, so a code glimpsed
 * over somebody's shoulder last week is useless today.
 */
export function newPairingCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export function normalisePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(normalisePairingCode(a), 'utf8');
  const y = Buffer.from(normalisePairingCode(b), 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export class PairingLockedError extends Error {}

/**
 * Guards the pairing code against being guessed.
 *
 * The code is short enough to type on a tablet, which means it is short
 * enough to guess given enough attempts. After a handful of wrong ones
 * pairing stops until the program is restarted - a nuisance exactly
 * once, and only for somebody who is not the assistant.
 */
export class PairingDesk {
  private code: string;
  private failures = 0;
  private readonly maxFailures: number;
  /**
   * Which chamber the NEXT tablet to pair belongs to. The decision is
   * made on the laptop rather than on the tablet: the doctor knows
   * which desk the thing in his hand is going to sit on, and a tablet
   * that could choose its own chamber could choose the wrong one.
   */
  private pairingChamber: string | null = null;

  constructor(maxFailures = 8) {
    this.code = newPairingCode();
    this.maxFailures = maxFailures;
  }

  get currentCode(): string { return this.code; }
  get chamberForNextTablet(): string | null { return this.pairingChamber; }
  set chamberForNextTablet(chamberId: string | null) { this.pairingChamber = chamberId; }
  get locked(): boolean { return this.failures >= this.maxFailures; }
  get attemptsLeft(): number { return Math.max(0, this.maxFailures - this.failures); }

  /**
   * Returns the tablet's token, or throws if the code was wrong.
   *
   * A tablet is bound to ONE chamber here and never moves. That is what
   * makes it safe for it to give out serial numbers with no laptop in
   * the room: a serial has to be unique for a chamber on a day, and
   * exactly one tablet gives them out for that chamber.
   */
  pair(db: Db, submittedCode: string, label: string, chamberId: string): string {
    if (this.locked) {
      throw new PairingLockedError(
        'Too many wrong codes have been tried. Close the program and open it again to pair a tablet.',
      );
    }
    if (!codesMatch(submittedCode, this.code)) {
      this.failures += 1;
      recordAudit(db, {
        actor: { id: null, role: 'system' }, action: 'tablet_pairing_failed', entity: 'tablet_device', entityId: null,
        details: { attempts_left: this.attemptsLeft },
      });
      throw new Error('That code is not right.');
    }

    const chamber = db.prepare('SELECT id, name FROM chamber WHERE id = ? AND deleted_at IS NULL')
      .get(chamberId) as { id: string; name: string } | undefined;
    if (chamber === undefined) {
      throw new Error('That chamber is not in this installation, so the tablet was not paired.');
    }

    const token = randomBytes(32).toString('hex');
    const id = newId();
    db.prepare('INSERT INTO tablet_device (id, label, token_hash, paired_at, chamber_id) VALUES (?, ?, ?, ?, ?)')
      .run(id, label.slice(0, 60), hashToken(token), nowIso(), chamber.id);
    recordAudit(db, {
      actor: { id: null, role: 'system' }, action: 'tablet_paired', entity: 'tablet_device', entityId: id,
      details: { label: label.slice(0, 60), chamber: chamber.name },
    });

    // A fresh code after every success, so pairing one tablet does not
    // leave the door open for the next device that asks.
    this.code = newPairingCode();
    this.failures = 0;
    return token;
  }
}

export interface PairedDevice { id: string; label: string; chamberId: string | null }

/** Null when the token is unknown or the tablet has been revoked. */
export function deviceForToken(db: Db, token: string | null): PairedDevice | null {
  if (token === null || token === '') return null;
  const row = db.prepare(
    'SELECT id, label, chamber_id AS chamberId FROM tablet_device WHERE token_hash = ? AND revoked_at IS NULL',
  ).get(hashToken(token)) as PairedDevice | undefined;
  if (row === undefined) return null;
  db.prepare('UPDATE tablet_device SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.id);
  return row;
}

export function pairedDevices(db: Db):
  Array<PairedDevice & { pairedAt: string; lastSeenAt: string | null; chamberName: string | null }> {
  return db.prepare(
    `SELECT d.id, d.label, d.chamber_id AS chamberId, d.paired_at AS pairedAt,
            d.last_seen_at AS lastSeenAt, c.name AS chamberName
     FROM tablet_device d
     LEFT JOIN chamber c ON c.id = d.chamber_id
     WHERE d.revoked_at IS NULL ORDER BY d.paired_at`,
  ).all() as Array<PairedDevice & { pairedAt: string; lastSeenAt: string | null; chamberName: string | null }>;
}

/** Move a tablet to another chamber. The desk it sits on moved, or it
 *  was paired to the wrong one. Recorded, because which chamber a
 *  tablet speaks for decides which register its serials come from. */
export function setDeviceChamber(db: Db, id: string, chamberId: string): void {
  const chamber = db.prepare('SELECT id, name FROM chamber WHERE id = ? AND deleted_at IS NULL')
    .get(chamberId) as { id: string; name: string } | undefined;
  if (chamber === undefined) throw new Error('That chamber is not in this installation.');
  db.prepare('UPDATE tablet_device SET chamber_id = ? WHERE id = ?').run(chamber.id, id);
  recordAudit(db, {
    actor: { id: null, role: 'system' }, action: 'tablet_chamber_set', entity: 'tablet_device', entityId: id,
    details: { chamber: chamber.name },
  });
}

export function revokeDevice(db: Db, id: string): void {
  db.prepare('UPDATE tablet_device SET revoked_at = ? WHERE id = ?').run(nowIso(), id);
  recordAudit(db, {
    actor: { id: null, role: 'system' }, action: 'tablet_revoked', entity: 'tablet_device', entityId: id, details: null,
  });
}
