import { randomUUID } from 'node:crypto';

/** Every id in the system is a random uuid generated here. */
export function newId(): string {
  return randomUUID();
}
