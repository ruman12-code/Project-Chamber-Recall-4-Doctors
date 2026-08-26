/**
 * One place that says what "now" is, so that tests can be deterministic
 * and so that every timestamp in the database has the same shape.
 * Always UTC, always ISO-8601 with milliseconds.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Which working evening we are in, 'YYYY-MM-DD'. THIS is what a
 * register, a queue and a serial number are keyed on -- not the
 * calendar day, because the Popular session runs past midnight and a
 * calendar day would restart the serials and empty the list in the
 * middle of it. See src/shared/sessionDay.ts.
 */
export { sessionDate, pastMidnight, ROLL_HOUR } from '../../shared/sessionDay';

/**
 * A calendar day in local time, 'YYYY-MM-DD'.
 *
 * For dates that are genuinely calendar dates: the day an age was
 * recorded, the date printed on a prescription, how long ago a backup
 * was taken. NOT for anything to do with today's list or a serial
 * number -- use sessionDate for those.
 */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
