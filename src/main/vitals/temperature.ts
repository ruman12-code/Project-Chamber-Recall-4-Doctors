// ===================================================================
// Temperature entry in either scale.
// ===================================================================
// Chambers in Bangladesh use both. A clinical thermometer reads
// Fahrenheit; a hospital chart reads Celsius. The doctor asked to be
// able to type either and have it converted.
//
// It is stored in Celsius, always, in one column. Two units in one
// column is how "99.8 °C" ends up in a patient record.
//
// WHY THE UNIT IS ALWAYS EXPLICIT, AND NEVER GUESSED FROM THE NUMBER
//
// It is tempting to work the scale out from the value: anything above
// 45 must be Fahrenheit, anything below must be Celsius. That works
// for most numbers and fails for the ones that matter.
//
//   38   is a fever in Celsius and impossible in Fahrenheit
//   99   is normal in Fahrenheit and impossible in Celsius
//   40   is a high fever in Celsius and hypothermic in Fahrenheit
//
// A guess that is right ninety-nine times and silently wrong once has
// put a wrong temperature in a patient's record, and it will look
// perfectly plausible there forever. So the person entering it says
// which scale, the software converts, and both the number they typed
// and the converted value are shown back before it is saved.
//
// What the software DOES do is notice when a number looks like the
// other scale and ask. It asks; it never corrects, and it never blocks.

export type TemperatureUnit = 'C' | 'F';

/** The range a living person's temperature falls in, in Celsius. */
const PLAUSIBLE_C = { low: 30, high: 45 } as const;

export function fahrenheitToCelsius(fahrenheit: number): number {
  return Math.round(((fahrenheit - 32) * 5 / 9) * 10) / 10;
}

export function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9 / 5 + 32) * 10) / 10;
}

export function toCelsius(value: number, unit: TemperatureUnit): number {
  return unit === 'C' ? Math.round(value * 10) / 10 : fahrenheitToCelsius(value);
}

export interface TemperatureEntry {
  /** What gets stored. Null when the box is empty or not a number. */
  celsius: number | null;
  /** Shown beside the box so the conversion is never invisible. */
  echo: string | null;
  /**
   * A question, never a correction. Null when there is nothing to ask.
   * The value is stored either way: this never blocks saving.
   */
  question: string | null;
}

/**
 * Turns what was typed into what gets stored, plus what to show the
 * person who typed it.
 */
export function readTemperature(raw: string, unit: TemperatureUnit): TemperatureEntry {
  const trimmed = raw.trim();
  if (trimmed === '') return { celsius: null, echo: null, question: null };

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { celsius: null, echo: null, question: `"${trimmed}" is not a number.` };
  }

  const celsius = toCelsius(value, unit);
  const echo = unit === 'F' ? `${value} °F = ${celsius.toFixed(1)} °C` : `${celsius.toFixed(1)} °C`;

  return { celsius, echo, question: questionAbout(value, unit, celsius) };
}

/**
 * Looks for the two mistakes worth asking about: a value that is not a
 * possible body temperature at all, and a value that would be a
 * perfectly ordinary reading in the other scale.
 */
function questionAbout(typed: number, unit: TemperatureUnit, celsius: number): string | null {
  const plausible = celsius >= PLAUSIBLE_C.low && celsius <= PLAUSIBLE_C.high;

  if (unit === 'C') {
    const asFahrenheit = fahrenheitToCelsius(typed);
    if (!plausible && asFahrenheit >= PLAUSIBLE_C.low && asFahrenheit <= PLAUSIBLE_C.high) {
      return `${typed} °C is not a possible body temperature. Did you mean ${typed} °F, which is ${asFahrenheit.toFixed(1)} °C?`;
    }
  } else {
    const asCelsius = Math.round(typed * 10) / 10;
    if (!plausible && asCelsius >= PLAUSIBLE_C.low && asCelsius <= PLAUSIBLE_C.high) {
      return `${typed} °F is not a possible body temperature. Did you mean ${typed} °C?`;
    }
  }

  if (!plausible) {
    return `${celsius.toFixed(1)} °C is outside the range a person's temperature can be. Check the reading.`;
  }
  return null;
}
