/**
 * Name normalisation for search.
 *
 * Version 1 does Unicode normalisation and substring matching, and
 * nothing else. There is deliberately NO phonetic matching: for Bangla
 * names a phonetic guess that silently merges two different people is a
 * far worse outcome than a search that makes the assistant type one
 * more letter.
 *
 * NFC is used because Bangla text arriving from different keyboards and
 * phones can carry the same visible name as different code point
 * sequences. Without this, two spellings of the same name would not
 * match each other even though they look identical on screen.
 */
export function normaliseName(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const cleaned = input.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return cleaned.length === 0 ? null : cleaned;
}

/**
 * Phone numbers are stored as typed, but compared on digits only, so
 * that 01712-345678, +8801712345678 and 01712 345678 are recognised as
 * the same handset.
 */
export function normalisePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const digits = input.replace(/\D/g, '');
  return digits.length === 0 ? null : digits;
}
