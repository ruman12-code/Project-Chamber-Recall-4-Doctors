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
 * Phone numbers are stored exactly as typed, because that is what the
 * patient said and what gets dialled. This is the copy that gets
 * searched.
 *
 * A Bangladeshi mobile number is written every one of these ways, and
 * all of them are the same handset:
 *
 *   01712345678      as printed on a card
 *   01712-345678     as written by hand
 *   +8801712345678   as stored by a phone that has called abroad
 *   0171 234 5678    as typed by someone in a hurry
 *
 * All of them reduce to 1712345678: digits only, the international
 * prefix removed, the trunk zero removed. A partial number reduces the
 * same way, so an assistant who remembers only the last few digits
 * still finds the patient.
 */
export function searchablePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('00880')) digits = digits.slice(5);
  else if (digits.startsWith('880') && digits.length >= 12) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 0 ? null : digits;
}

/** Digits exactly as given, with nothing removed. */
export function normalisePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const digits = input.replace(/\D/g, '');
  return digits.length === 0 ? null : digits;
}
