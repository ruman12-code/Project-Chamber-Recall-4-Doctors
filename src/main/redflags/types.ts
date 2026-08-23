// The shape of a loaded rulebook, with nothing in it that only exists
// on the laptop.
//
// This file is separate from rulebook.ts on purpose: the tablet runs the
// rule evaluator itself so that a warning appears with no wifi, and the
// tablet must not reach into anything that needs Node - not even for a
// type. Keeping the types here makes that impossible to get wrong by
// accident rather than merely unlikely.
import type { Condition } from '../rules/conditions';

export interface Rule {
  id: string;
  version: string;
  status: 'placeholder' | 'approved';
  message: { bn: string; en: string };
  when: Condition;
  /** Every question this rule can ask about. Used for reporting. */
  questionsUsed: string[];
}

export interface Rulebook {
  approvedBy: string;
  approvedOn: string;
  rules: Rule[];
  /** Fingerprint of the file exactly as it was read. */
  checksum: string;
  sourcePath: string;
}
