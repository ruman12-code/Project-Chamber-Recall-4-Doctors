import { join } from 'node:path';

/**
 * Everything this system stores lives in ONE folder: the database, the
 * key file, and later the attachment images. One folder means the whole
 * installation can be backed up, moved to a replacement laptop, or
 * handed to another developer by copying a single directory.
 *
 * The location can be overridden with CHAMBER_RECALL_DATA_DIR, which is
 * how the tests and the seed script keep well away from real data.
 */
export function dataDir(fallback: string): string {
  return process.env.CHAMBER_RECALL_DATA_DIR ?? fallback;
}

export const DB_FILENAME = 'chamber-recall.db';
export const KEYSTORE_FILENAME = 'keystore.json';
/**
 * The red flag rules live in the data folder, not inside the
 * application, because this is the one file the doctor edits himself.
 * Keeping it beside the database means it is backed up with the
 * records, and means reinstalling the software never overwrites rules a
 * clinician approved.
 */
export const RULEBOOK_FILENAME = 'red_flags.yaml';
/** The intake questions, edited by the doctor in the same folder. */
export const QUESTIONS_FILENAME = 'questions.yaml';

export function dbPath(dir: string): string {
  return join(dir, DB_FILENAME);
}
export function keystorePath(dir: string): string {
  return join(dir, KEYSTORE_FILENAME);
}
export function rulebookPath(dir: string): string {
  return join(dir, RULEBOOK_FILENAME);
}
export function questionsPath(dir: string): string {
  return join(dir, QUESTIONS_FILENAME);
}
