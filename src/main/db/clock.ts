/**
 * One place that says what "now" is, so that tests can be deterministic
 * and so that every timestamp in the database has the same shape.
 * Always UTC, always ISO-8601 with milliseconds.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** A calendar day in local time, 'YYYY-MM-DD'. Used for visit_date. */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
