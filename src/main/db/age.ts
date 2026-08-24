/**
 * Working out a patient's age.
 *
 * Two cases, and the second is the one that goes wrong quietly:
 *
 *   dob                  exact, count the years
 *   approx_age_years     an estimate given on a particular day
 *
 * An estimate must always be aged forward from the day it was taken. A
 * patient recorded as 45 three years ago is 48 now, and showing 45 on
 * the doctor's screen is a small error that never announces itself.
 *
 * It works backwards too, and has to. Asking what somebody's age was
 * at a visit two years before their age was written down is an
 * ordinary question - the pilot report asks it of every visit - and
 * "45 today" means "43 two years ago" by the same arithmetic. Refusing
 * to answer left a whole column of a research export empty.
 */
export interface AgeSource {
  dob: string | null;
  approx_age_years: number | null;
  approx_age_recorded_on: string | null;
}

function wholeYearsBetween(fromIso: string, to: Date): number | null {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  let years = to.getFullYear() - from.getFullYear();
  const monthDiff = to.getMonth() - from.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && to.getDate() < from.getDate())) years -= 1;
  return years;
}

export function patientAgeYears(source: AgeSource, asOf: Date = new Date()): number | null {
  if (source.dob !== null) {
    const years = wholeYearsBetween(source.dob, asOf);
    return years === null || years < 0 ? null : years;
  }
  if (source.approx_age_years !== null && source.approx_age_recorded_on !== null) {
    const elapsed = wholeYearsBetween(source.approx_age_recorded_on, asOf);
    if (elapsed === null) return null;
    const age = source.approx_age_years + elapsed;
    // Before they were born, by this estimate. The estimate is what is
    // wrong, so the honest answer is that the age is not known.
    return age < 0 ? null : age;
  }
  return null;
}
