// Name and phone normalisation lives in src/shared/names.ts, because
// the TABLET has to normalise a search term exactly the way the laptop
// does. Two implementations of "is this the same phone number" would
// drift, and the day they drifted the desk would be told a returning
// patient was new.
//
// Re-exported from here so that every existing import still reads the
// way it did.
export { normaliseName, searchablePhone } from '../../shared/names';
