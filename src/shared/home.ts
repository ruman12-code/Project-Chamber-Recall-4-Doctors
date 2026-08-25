// ===================================================================
// What is on the doctor's home screen.
// ===================================================================
// The home screen opens on the evening: the counts, and today's list
// with every action on it. That part is not a choice, because it is
// what the screen is FOR.
//
// Everything else is a choice, and it is the doctor's. He has told us
// he wants to decide after using it rather than before, which is the
// right way round, so the panels below are a setting rather than a
// decision taken here.
//
// One rule governs the whole thing: TURNING SOMETHING OFF NEVER MAKES
// IT UNREACHABLE. Anything not pinned to the front page is still there
// under "Everything else". The setting decides what he sees without
// looking for it, not what the program can do.

export const HOME_PANELS = [
  {
    id: 'recall_card',
    label: 'The Recall Card',
    what: 'The patient with the doctor right now, and their history.',
    roles: ['doctor', 'clinical_assistant'],
  },
  {
    id: 'find_patient',
    label: 'Find a patient',
    what: 'Search by phone or name, register somebody, merge duplicates.',
    roles: ['doctor', 'clinical_assistant', 'front_desk'],
  },
  {
    id: 'tablet',
    label: 'The front desk tablet',
    what: 'The address to type into the tablet, and which tablets are paired.',
    roles: ['doctor', 'clinical_assistant', 'front_desk'],
  },
  {
    id: 'backup',
    label: 'Backups',
    what: 'How many days since the last one, and the button to take one.',
    roles: ['doctor', 'clinical_assistant', 'front_desk'],
  },
  {
    id: 'patient_copy',
    label: "A patient's own copy",
    what: 'Print or write out the copy of their record a patient can ask for.',
    roles: ['doctor', 'clinical_assistant'],
  },
  {
    id: 'pilot_report',
    label: 'The pilot report',
    what: 'What has happened since this started. Counts, and no verdict.',
    roles: ['doctor', 'clinical_assistant'],
  },
  {
    id: 'who_works_here',
    label: 'Who works here',
    what: 'Add somebody, change a PIN, retire somebody who has left.',
    roles: ['doctor'],
  },
  {
    id: 'database',
    label: 'What is in the database',
    what: 'How many patients, visits, encounters and so on.',
    roles: ['doctor', 'clinical_assistant', 'front_desk'],
  },
] as const;

export type HomePanelId = (typeof HOME_PANELS)[number]['id'];

/**
 * What is pinned before anybody chooses. The four things wanted on an
 * ordinary evening; the rest are one tap away under "Everything else".
 */
export const DEFAULT_HOME_PANELS: HomePanelId[] = [
  'recall_card', 'find_patient', 'tablet', 'backup',
];

export function isHomePanelId(value: string): value is HomePanelId {
  return HOME_PANELS.some((p) => p.id === value);
}

/** The panels this role is allowed to see at all, pinned or not. */
export function panelsForRole(role: string): typeof HOME_PANELS[number][] {
  return HOME_PANELS.filter((p) => (p.roles as readonly string[]).includes(role));
}
