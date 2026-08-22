// Named errors. The rule in this project is that nothing fails silently
// and nothing fails in jargon. Every error that can reach a screen
// carries a plain-language sentence and, where possible, a sentence
// telling the user what to do about it.

export class ChamberRecallError extends Error {
  /** Shown to the user. Plain language, no jargon, no error codes. */
  readonly userMessage: string;
  /** Shown under it. What the user should actually do next. */
  readonly whatToDo: string;

  constructor(userMessage: string, whatToDo: string, cause?: unknown) {
    super(userMessage, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.userMessage = userMessage;
    this.whatToDo = whatToDo;
  }
}

export class WrongPassphraseError extends ChamberRecallError {
  constructor() {
    super(
      'That password did not open the records.',
      'Check the password and try again. If you cannot remember it, use the recovery key you printed when the system was set up.',
    );
  }
}

export class WrongRecoveryKeyError extends ChamberRecallError {
  constructor() {
    super(
      'That recovery key did not open the records.',
      'Check every character against the sheet you printed. The key has 8 groups of 4 characters.',
    );
  }
}

export class KeystoreMissingError extends ChamberRecallError {
  constructor(path: string) {
    super(
      'The key file for the patient records is missing.',
      `The records cannot be opened without it. It should be at: ${path}. Restore it from a backup before going any further. Do not set up a new database over the old one.`,
    );
  }
}

export class KeystoreCorruptError extends ChamberRecallError {
  constructor(path: string, cause?: unknown) {
    super(
      'The key file for the patient records is damaged and cannot be read.',
      `Restore the whole data folder from your most recent backup. The file is at: ${path}. Do not delete it.`,
      cause,
    );
  }
}

export class DatabaseUnreadableError extends ChamberRecallError {
  constructor(path: string, cause?: unknown) {
    super(
      'The patient records file could not be opened.',
      `The file is at: ${path}. This usually means the file is damaged or is not the file this key belongs to. Restore from your most recent backup.`,
      cause,
    );
  }
}

export class SeedRefusedError extends ChamberRecallError {
  constructor(reason: string) {
    super(
      'Refusing to write practice data into this database.',
      reason,
    );
  }
}
