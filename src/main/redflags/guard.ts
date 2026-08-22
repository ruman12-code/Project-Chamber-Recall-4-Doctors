// ===================================================================
// The refuse-to-run guard.
// ===================================================================
// The application will not see real patients until a doctor has
// replaced every placeholder rule and said so in the file.
//
// This exists because of a specific failure it is designed to prevent:
// someone in a hurry - including me - shipping screening rules that no
// clinician ever approved, and nobody noticing because the software ran
// perfectly well without them.
//
// The guard applies to LIVE databases only. A demo database runs with
// placeholder rules, loudly labelled, so the rest of the software can
// be built and shown.
import type { Rulebook } from './rulebook';
import type { RulebookProblem } from './rulebook';

export interface LiveModeBlock {
  reason: string;
  whatToDo: string;
}

const PLACEHOLDER_MARKER = /PLACEHOLDER/i;

/**
 * Returns every reason this rulebook must not be used for real
 * patients. An empty list means it may be.
 */
export function blocksLiveUse(rulebook: Rulebook | null, problems: RulebookProblem[]): LiveModeBlock[] {
  const blocks: LiveModeBlock[] = [];

  if (rulebook === null) {
    blocks.push({
      reason: problems.length > 0
        ? `The red flag rules file could not be read: ${problems.length} problem${problems.length === 1 ? '' : 's'} found.`
        : 'The red flag rules file could not be read.',
      whatToDo: 'Fix the problems listed below in red_flags.yaml. Until it can be read, there is no screening at all, so the software will not open patient records.',
    });
    return blocks;
  }

  if (rulebook.rules.length === 0) {
    blocks.push({
      reason: 'There are no red flag rules at all.',
      whatToDo: 'A chamber with no rules has no screening. Add the rules a doctor has approved to red_flags.yaml.',
    });
  }

  const unapproved = rulebook.rules.filter((r) => r.status !== 'approved');
  if (unapproved.length > 0) {
    blocks.push({
      reason: `${unapproved.length} rule${unapproved.length === 1 ? ' is' : 's are'} still marked as a placeholder: ${unapproved.map((r) => r.id).join(', ')}.`,
      whatToDo: 'A doctor must replace each one with a real rule and change its status to "approved" in red_flags.yaml.',
    });
  }

  const withMarker = rulebook.rules.filter(
    (r) => PLACEHOLDER_MARKER.test(r.id) || PLACEHOLDER_MARKER.test(r.message.bn) || PLACEHOLDER_MARKER.test(r.message.en),
  );
  if (withMarker.length > 0) {
    blocks.push({
      reason: `${withMarker.length} rule${withMarker.length === 1 ? '' : 's'} still contain${withMarker.length === 1 ? 's' : ''} the word PLACEHOLDER: ${withMarker.map((r) => r.id).join(', ')}.`,
      whatToDo: 'These were shipped as examples. Replace their text with what the assistant should actually be told.',
    });
  }

  if (rulebook.approvedBy === '') {
    blocks.push({
      reason: 'Nobody has signed off the rules file.',
      whatToDo: 'The doctor who approved these rules writes his name on the approved_by line in red_flags.yaml.',
    });
  }
  if (rulebook.approvedOn === '') {
    blocks.push({
      reason: 'The rules file does not say when it was approved.',
      whatToDo: 'Write the date on the approved_on line in red_flags.yaml, for example 2026-09-01.',
    });
  }

  return blocks;
}
