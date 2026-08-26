// ===================================================================
// Which working evening a moment belongs to.
// ===================================================================
// The doctor sits at Lubana from about half three until seven, and at
// Popular from about eight until half eleven -- and some nights until
// midnight, and some nights past it.
//
// Everything in this program that means "today" used to mean the
// calendar day. Read that sentence again next to those hours: at the
// stroke of midnight, in the middle of the Popular session, with eight
// people still waiting --
//
//   * the serial register would start again at 1, and the next patient
//     would be handed a number somebody in the same room already had;
//   * today's list on the doctor's screen would empty, because it asks
//     for the visits of the current calendar day and there were none
//     yet;
//   * the tablet's buffer of serials, keyed on the date, would decide
//     it was for a different day and reset itself.
//
// None of that is recoverable at the desk while it is happening.
//
// So a working day here runs from ROLL_HOUR one morning to ROLL_HOUR
// the next. A patient registered at ten past midnight belongs to the
// evening that started at eight, gets the next serial in it, and stays
// on the same list as the patient before them. Nothing else changes:
// the timestamps on every record are still the real moment, to the
// millisecond, in UTC. This decides one thing only -- which day's
// register a patient is written into.
//
// WHY FIVE IN THE MORNING
//
// It has to be after the latest a session could conceivably run and
// before the earliest one could conceivably start. The stated hours are
// 15:30 at the earliest and around midnight at the latest, so five
// leaves five hours of margin on the late side and ten on the early
// side. A chamber that one night ran until 4am would still be one
// evening. A chamber that started at 4am would not, and that is a
// morning clinic nobody has described.

/** The hour a new working day begins, in local time. */
export const ROLL_HOUR = 5;

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The working day a moment belongs to, 'YYYY-MM-DD', in local time.
 *
 * Before ROLL_HOUR this is YESTERDAY's date, because the evening that
 * is still going started yesterday.
 */
export function sessionDate(at: Date = new Date(), rollHour: number = ROLL_HOUR): string {
  if (at.getHours() >= rollHour) return ymd(at);
  const previous = new Date(at.getTime());
  previous.setDate(previous.getDate() - 1);
  return ymd(previous);
}

/**
 * True when the session day and the calendar day differ -- i.e. it is
 * after midnight and the evening is still running. The screens say so,
 * because a list headed with yesterday's date at half past midnight
 * looks like a bug to the person reading it.
 */
export function pastMidnight(at: Date = new Date(), rollHour: number = ROLL_HOUR): boolean {
  return at.getHours() < rollHour;
}
