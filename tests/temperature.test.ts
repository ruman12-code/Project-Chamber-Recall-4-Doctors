import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readTemperature, toCelsius, fahrenheitToCelsius, celsiusToFahrenheit } from '../src/main/vitals/temperature';

describe('converting temperature', () => {
  test('the fixed points are right', () => {
    assert.equal(fahrenheitToCelsius(32), 0);
    assert.equal(fahrenheitToCelsius(212), 100);
    assert.equal(celsiusToFahrenheit(37), 98.6);
  });

  test('a normal reading converts to one decimal place', () => {
    assert.equal(toCelsius(98.6, 'F'), 37);
    assert.equal(toCelsius(101, 'F'), 38.3);
    assert.equal(toCelsius(37.2, 'C'), 37.2);
  });

  test('what was typed is echoed back beside the conversion', () => {
    // The conversion must never be invisible to the person doing it.
    assert.equal(readTemperature('101', 'F').echo, '101 °F = 38.3 °C');
    assert.equal(readTemperature('38.3', 'C').echo, '38.3 °C');
  });

  test('an empty box stores nothing and asks nothing', () => {
    assert.deepEqual(readTemperature('  ', 'C'), { celsius: null, echo: null, question: null });
  });

  test('something that is not a number is refused, in plain words', () => {
    const entry = readTemperature('abc', 'C');
    assert.equal(entry.celsius, null);
    assert.match(entry.question!, /is not a number/);
  });
});

describe('the unit is never guessed from the number', () => {
  // The whole point: these two numbers are each perfectly ordinary in
  // one scale and impossible in the other. Any software that decides
  // for itself gets one of them wrong eventually, and the wrong value
  // looks entirely plausible in the record afterwards.
  test('38 typed as Celsius is a fever, and is stored as one', () => {
    const entry = readTemperature('38', 'C');
    assert.equal(entry.celsius, 38);
    assert.equal(entry.question, null, 'a fever in Celsius must not be questioned');
  });

  test('99 typed as Fahrenheit is normal, and is stored as 37.2', () => {
    const entry = readTemperature('99', 'F');
    assert.equal(entry.celsius, 37.2);
    assert.equal(entry.question, null);
  });

  test('40 means two completely different things and is taken at its word in both', () => {
    assert.equal(readTemperature('40', 'C').celsius, 40);
    assert.equal(readTemperature('40', 'F').celsius, 4.4);
  });
});

describe('a value that looks like the other scale is questioned, never corrected', () => {
  test('99 typed as Celsius asks whether Fahrenheit was meant', () => {
    // Exactly the mistake that put Fahrenheit numbers in a Celsius
    // column in the practice data during milestone 3.
    const entry = readTemperature('99', 'C');
    assert.match(entry.question!, /Did you mean 99 °F, which is 37\.2 °C\?/);
    assert.equal(entry.celsius, 99, 'the typed value is still what would be stored: the software does not overrule anyone');
  });

  test('37 typed as Fahrenheit asks whether Celsius was meant', () => {
    const entry = readTemperature('37', 'F');
    assert.match(entry.question!, /Did you mean 37 °C\?/);
  });

  test('a value impossible in both scales is questioned as impossible', () => {
    const entry = readTemperature('1200', 'C');
    assert.match(entry.question!, /outside the range/);
    assert.equal(entry.celsius, 1200);
  });

  test('asking never blocks: a questioned value still has something to store', () => {
    for (const [raw, unit] of [['99', 'C'], ['37', 'F'], ['1200', 'C']] as const) {
      assert.notEqual(readTemperature(raw, unit).celsius, null);
    }
  });
});
