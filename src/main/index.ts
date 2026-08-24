// ===================================================================
// The application process.
// ===================================================================
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNELS, type InstallationStatus, type DatabaseSummary, type RedFlagStatus,
  type RedFlagAlertView, type Result } from '../shared/ipc';
import { ChamberRecallError } from '../shared/errors';
import { dataDir, dbPath } from './paths';
import { provision, openWithPassphrase, isProvisioned } from './db/provision';
import { dataMode, getMeta, type Db } from './db/open';
import { recentAudit } from './db/audit';
import { loadRulebookFromDisk, acknowledgeRedFlag } from './redflags/store';
import { blocksLiveUse } from './redflags/guard';
import { rulebookPath } from './paths';
import { buildRecallCard, currentVisitId } from './recall/card';
import { localDate } from './db/clock';
import type { RecallCard } from '../shared/recall';
import { searchPatients } from './patients/search';
import { registerPatient } from './patients/register';
import { previewMerge, mergePatients, undoMerge } from './patients/merge';
import type { PatientSearchResult, RegisterPatientInput, MergePreview } from '../shared/patients';
import { registerArrival, setVisitStatus } from './queue/register';
import { todaysQueue, moveInQueue, activeChamberId, setActiveChamber, chambers } from './queue/queue';
import type { QueueView, VisitStatus } from '../shared/queue';
import { startTabletServer, DEFAULT_PORT, type RunningServer } from './server/server';
import { pairedDevices, revokeDevice } from './server/pairing';
import { unassignedActor, laptopRole, setLaptopRole, laptopActor, type UnassignedRole } from './db/users';
import { confirmIntake, unconfirmIntake, correctIntakeAnswer, type CorrectionInput } from './intake/confirm';
import { loadConsentConfig } from './consent/config';
import type { TabletStatus, AuthState, SignedInView, StaffView } from '../shared/ipc';
import { signIn as doSignIn, signOutAudit, actorOf, type SignedIn } from './auth/session';
import { needsSetup, signInList, allStaff, addStaff, setPin, setStaffActive } from './auth/staff';
import { openEncounter, saveDraft, setMedications, setInvestigations, confirmEncounter, unconfirmEncounter }
  from './clinical/encounter';
import { saveVitals, questionsAbout } from './clinical/vitals';
import { chamberView } from './clinical/chamber';
import { requireClinicalRole } from './clinical/access';
import type { ChamberView, VitalsInput, VitalsQuestion, EncounterDraft, MedicationInput } from '../shared/clinical';
import type { Role } from '../shared/roles';
import { buildPrescription, recordPrescriptionPrinted } from './prescription/build';
import { loadPrescriptionConfig } from './prescription/config';
import { prescriptionPath } from './paths';
import type { PrescriptionView, PrescriptionStatus } from '../shared/prescription';
import { addAttachment, attachmentsFor, attachmentContent, removeAttachment } from './attachments/store';
import type { AttachmentView as AttachmentRow, AttachmentKind } from './attachments/store';

let db: Db | null = null;
let installDir = '';
/** Who is at this laptop right now. Memory only; closing signs out. */
let signedIn: SignedIn | null = null;
let tabletServer: RunningServer | null = null;
let tabletProblem: string | null = null;

/**
 * The tablet cannot be served until the records are unlocked, because
 * everything it asks for comes out of the encrypted database. So the
 * server starts the moment the doctor opens the records, and stops when
 * the program closes.
 */
async function startTabletServing(): Promise<void> {
  if (tabletServer !== null || db === null) return;
  try {
    tabletServer = await startTabletServer({
      db,
      dataDir: installDir,
      webRoot: join(__dirname, '..', '..', 'tablet'),
      port: DEFAULT_PORT,
    });
    tabletProblem = null;
    console.log(`Tablet server on port ${tabletServer.port}: ${tabletServer.addresses.join(', ')}`);
  } catch (error) {
    const message = String((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE'
      ? `Something else on this laptop is already using port ${DEFAULT_PORT}, so the tablet cannot connect.`
      : (error as Error)?.message ?? error);
    tabletProblem = message;
    console.error('[tablet server] could not start:', error);
  }
}

/**
 * Every handler goes through here.
 *
 * The rule this enforces: nothing fails silently, and nothing reaches
 * the user as a stack trace. An expected failure carries its own plain
 * sentence. An unexpected one still says clearly that something broke
 * and that the work has not been saved, because the alternative - a
 * screen that looks fine while nothing is being written - is the worst
 * outcome this system can produce.
 */
function handle<T extends object>(channel: string, fn: (...args: never[]) => T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, ...fn(...(args as never[])) } as Result<T>;
    } catch (error) {
      if (error instanceof ChamberRecallError) {
        console.error(`[${channel}] ${error.name}: ${error.message}`);
        return { ok: false, userMessage: error.userMessage, whatToDo: error.whatToDo, technical: String(error.stack ?? error) };
      }
      console.error(`[${channel}] unexpected failure`, error);
      return {
        ok: false,
        userMessage: 'Something in the program went wrong and this action did not complete.',
        whatToDo: 'Nothing was saved. Write down what you were doing, close the program and open it again. If it keeps happening, report it before entering more patients.',
        technical: String((error as Error)?.stack ?? error),
      };
    }
  });
}

/**
 * Reads the rules file and reports on it. Read fresh every time rather
 * than cached: the doctor edits this file with a text editor while the
 * application is open, and a cached copy would tell him his corrections
 * had no effect.
 */
function readRedFlagStatus(): RedFlagStatus {
  const { rulebook, problems } = loadRulebookFromDisk(installDir);
  return {
    path: rulebookPath(installDir),
    loaded: rulebook !== null,
    ruleCount: rulebook?.rules.length ?? 0,
    approvedCount: rulebook?.rules.filter((r) => r.status === 'approved').length ?? 0,
    placeholderCount: rulebook?.rules.filter((r) => r.status !== 'approved').length ?? 0,
    approvedBy: rulebook?.approvedBy ?? '',
    approvedOn: rulebook?.approvedOn ?? '',
    checksum: rulebook?.checksum ?? null,
    problems,
    blocksLiveUse: blocksLiveUse(rulebook, problems),
  };
}

function registerHandlers(): void {
  handle<{ status: InstallationStatus }>(CHANNELS.status, () => ({
    status: {
      provisioned: isProvisioned(installDir),
      unlocked: db !== null,
      dataDir: installDir,
      dataMode: db === null ? null : dataMode(db),
    },
  }));

  handle<{ recoveryKey: string }>(CHANNELS.create, (passphrase: string, mode: 'demo' | 'live') => {
    const created = provision(installDir, passphrase, mode);
    db = created.db;
    return { recoveryKey: created.recoveryKey };
  });

  handle<Record<string, never>>(CHANNELS.unlock, (passphrase: string) => {
    db = openWithPassphrase(installDir, passphrase);
    void startTabletServing();
    return {} as Record<string, never>;
  });

  handle<{ summary: DatabaseSummary }>(CHANNELS.summary, () => {
    if (db === null) throw new Error('summary requested before the database was unlocked');
    const tables = ['patient', 'chamber', 'visit', 'intake', 'intake_answer', 'red_flag_event',
      'vitals', 'encounter', 'medication', 'investigation', 'attachment', 'app_user', 'audit_log', 'usage_event'];
    const counts: Record<string, number> = {};
    for (const t of tables) {
      counts[t] = (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    }
    counts['investigations_outstanding'] =
      (db.prepare('SELECT count(*) AS n FROM investigation WHERE result_date IS NULL').get() as { n: number }).n;
    counts['red_flag_evaluation'] =
      (db.prepare('SELECT count(*) AS n FROM red_flag_evaluation').get() as { n: number }).n;

    return {
      summary: {
        dataMode: dataMode(db),
        createdAt: getMeta(db, 'created_at'),
        seededAt: getMeta(db, 'seeded_at'),
        counts,
        redFlags: readRedFlagStatus(),
        recentAudit: recentAudit(db, 25).map(({ details_json, actor_id, ...rest }) => rest),
      },
    };
  });

  handle<{ status: RedFlagStatus }>(CHANNELS.redFlagStatus, () => ({ status: readRedFlagStatus() }));

  /**
   * One real alert out of the database, so the warning the assistant
   * sees can be looked at before the tablet interface exists. It is a
   * real row produced by the real rules, not a mock-up.
   */
  handle<{ alert: RedFlagAlertView | null }>(CHANNELS.redFlagSample, () => {
    if (db === null) throw new Error('an alert was requested before the database was unlocked');
    const { rulebook } = loadRulebookFromDisk(installDir);
    const row = db.prepare(
      `SELECT e.id AS eventId, e.rule_id AS ruleId, e.rule_version AS ruleVersion,
              COALESCE(p.full_name_bn, p.full_name_en) AS patientName, v.serial_no AS serialNo
       FROM red_flag_event e
       JOIN intake i  ON i.id = e.intake_id
       JOIN visit v   ON v.id = i.visit_id
       JOIN patient p ON p.id = v.patient_id
       WHERE e.acknowledged_at IS NULL
       ORDER BY e.fired_at DESC LIMIT 1`,
    ).get() as { eventId: string; ruleId: string; ruleVersion: string; patientName: string | null; serialNo: number | null } | undefined;

    if (row === undefined) return { alert: null };
    const rule = rulebook?.rules.find((r) => r.id === row.ruleId);
    return {
      alert: {
        ...row,
        messageBn: rule?.message.bn ?? '(this rule is no longer in the rules file)',
        messageEn: rule?.message.en ?? '(this rule is no longer in the rules file)',
      },
    };
  });

  /**
   * The Recall Card for whoever is with the doctor right now. If nobody
   * is in the chamber, the first patient still waiting today is used
   * instead, so the card can be looked at during the build.
   */
  /**
   * Nobody signs in until the setup wizard at milestone 9, so actions
   * are recorded against a row that says exactly that: "Front desk
   * (before sign-in was set up)". The record therefore has a real
   * author to point at, and that author tells the truth about itself.
   */
  const actor = unassignedActor('front_desk');
  /**
   * Who is doing this.
   *
   * Once anybody has been set up with a PIN, it is the person signed
   * in and nothing else - a screen that carries on working after the
   * doctor signs out would attribute his consultation to whoever
   * happened to be standing there.
   *
   * Before setup, on an installation from before sign-in existed, it
   * falls back to the milestone 8 laptop role so the program still
   * opens and can be used to reach the setup screen.
   */
  const atTheLaptop = () => {
    if (db === null) throw new Error('the actor was needed before the database was unlocked');
    if (signedIn !== null) return actorOf(signedIn);
    if (!needsSetup(db)) {
      throw new ChamberRecallError(
        'Nobody is signed in.',
        'Sign in first. Everything written here is recorded against the person who wrote it, so the program cannot record anything until it knows who you are.',
      );
    }
    return laptopActor(db);
  };

  handle<{ status: TabletStatus }>(CHANNELS.tabletStatus, () => {
    if (db === null) throw new Error('the tablet status was requested before the database was unlocked');
    return {
      status: {
        running: tabletServer !== null,
        port: tabletServer?.port ?? null,
        addresses: tabletServer?.addresses ?? [],
        pairingCode: tabletServer?.pairingCode ?? null,
        pairingLocked: tabletServer?.pairingLocked ?? false,
        devices: pairedDevices(db),
        problem: tabletProblem,
      },
    };
  });

  handle<Record<string, never>>(CHANNELS.tabletRevoke, (deviceId: string) => {
    if (db === null) throw new Error('a tablet was revoked before the database was unlocked');
    revokeDevice(db, deviceId);
    return {} as Record<string, never>;
  });

  handle<{ view: QueueView }>(CHANNELS.queueToday, () => {
    if (db === null) throw new Error('the queue was requested before the database was unlocked');
    const chamberId = activeChamberId(db);
    const all = chambers(db);
    return {
      view: {
        chamberId,
        chamberName: all.find((c) => c.id === chamberId)?.name ?? null,
        visitDate: localDate(),
        chambers: all,
        entries: chamberId === null ? [] : todaysQueue(db, chamberId, localDate()),
      },
    };
  });

  handle<Record<string, never>>(CHANNELS.queueSetChamber, (chamberId: string) => {
    if (db === null) throw new Error('a chamber was chosen before the database was unlocked');
    setActiveChamber(db, chamberId);
    return {} as Record<string, never>;
  });

  handle<{ serialNo: number; alreadyOnListVisitId: string | null }>(
    CHANNELS.queueRegisterArrival, (patientId: string, allowSecondVisitToday: boolean) => {
      if (db === null) throw new Error('a patient arrived before the database was unlocked');
      const chamberId = activeChamberId(db);
      if (chamberId === null) throw new Error('there is no chamber to register this patient into');
      const result = registerArrival(db, patientId, chamberId, actor, { allowSecondVisitToday });
      return { serialNo: result.serialNo, alreadyOnListVisitId: result.alreadyOnListVisitId };
    });

  handle<Record<string, never>>(CHANNELS.queueSetStatus, (visitId: string, status: VisitStatus) => {
    if (db === null) throw new Error('a visit was changed before the database was unlocked');
    setVisitStatus(db, visitId, status, actor);
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.queueMove, (visitId: string, direction: 'up' | 'down') => {
    if (db === null) throw new Error('the queue was reordered before the database was unlocked');
    moveInQueue(db, visitId, direction, actor);
    return {} as Record<string, never>;
  });

  handle<{ results: PatientSearchResult[] }>(CHANNELS.patientSearch, (query: string) => {
    if (db === null) throw new Error('a patient search was made before the database was unlocked');
    return { results: searchPatients(db, query) };
  });

  handle<{ id: string }>(CHANNELS.patientRegister, (input: RegisterPatientInput) => {
    if (db === null) throw new Error('a patient was registered before the database was unlocked');
    return { id: registerPatient(db, input, actor) };
  });

  handle<{ preview: MergePreview }>(CHANNELS.patientMergePreview, (survivingId: string, duplicateId: string) => {
    if (db === null) throw new Error('a merge was previewed before the database was unlocked');
    return { preview: previewMerge(db, survivingId, duplicateId) };
  });

  handle<{ visitsMoved: number }>(CHANNELS.patientMerge, (survivingId: string, duplicateId: string, note: string | null) => {
    if (db === null) throw new Error('a merge was made before the database was unlocked');
    return { visitsMoved: mergePatients(db, survivingId, duplicateId, actor, note).visitsMoved };
  });

  handle<{ visitsMoved: number }>(CHANNELS.patientUndoMerge, (duplicateId: string) => {
    if (db === null) throw new Error('a merge was undone before the database was unlocked');
    return { visitsMoved: undoMerge(db, duplicateId, actor).visitsMoved };
  });

  handle<{ role: string }>(CHANNELS.laptopRole, () => {
    if (db === null) throw new Error('the laptop role was requested before the database was unlocked');
    return { role: laptopRole(db) };
  });

  handle<Record<string, never>>(CHANNELS.setLaptopRole, (role: string) => {
    if (db === null) throw new Error('the laptop role was set before the database was unlocked');
    setLaptopRole(db, role as UnassignedRole);
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.intakeConfirm, (intakeId: string) => {
    if (db === null) throw new Error('an intake was confirmed before the database was unlocked');
    confirmIntake(db, intakeId, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.intakeUnconfirm, (intakeId: string) => {
    if (db === null) throw new Error('an intake was unconfirmed before the database was unlocked');
    unconfirmIntake(db, intakeId, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.intakeCorrect, (intakeId: string, correction: CorrectionInput) => {
    if (db === null) throw new Error('an intake was corrected before the database was unlocked');
    correctIntakeAnswer(db, intakeId, correction, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<{ card: RecallCard | null }>(CHANNELS.recallCard, (requestedVisitId?: string) => {
    if (db === null) throw new Error('the recall card was requested before the database was unlocked');
    // The card is somebody's medical history assembled for the person
    // treating them. The front desk runs the register and the queue,
    // and does not open this.
    requireClinicalRole(atTheLaptop(), 'open a patient\u2019s history');
    const today = localDate();
    let visitId = typeof requestedVisitId === 'string' && requestedVisitId !== ''
      ? requestedVisitId
      : currentVisitId(db, today);
    if (visitId === null) {
      const row = db.prepare(
        `SELECT id FROM visit WHERE visit_date = ? AND deleted_at IS NULL ORDER BY serial_no LIMIT 1`,
      ).get(today) as { id: string } | undefined;
      visitId = row?.id ?? null;
    }
    const { rulebook } = loadRulebookFromDisk(installDir);
    const consent = loadConsentConfig(installDir);
    return {
      card: visitId === null ? null
        : buildRecallCard(db, visitId, new Date(), rulebook, consent.config?.version ?? null),
    };
  });

  // ---------------- signing in ----------------

  const view = (who: SignedIn): SignedInView =>
    ({ id: who.id, displayName: who.displayName, role: who.role, since: who.since });

  handle<{ auth: AuthState }>(CHANNELS.whoIsSignedIn, () => {
    if (db === null) throw new Error('sign-in was asked about before the database was unlocked');
    return { auth: { needsSetup: needsSetup(db), signedIn: signedIn === null ? null : view(signedIn) } };
  });

  handle<{ people: StaffView[] }>(CHANNELS.signInList, () => {
    if (db === null) throw new Error('the sign-in list was asked for before the database was unlocked');
    return { people: signInList(db) };
  });

  handle<{ signedIn: SignedInView }>(CHANNELS.signIn, (userId: string, pin: string) => {
    if (db === null) throw new Error('somebody signed in before the database was unlocked');
    signedIn = doSignIn(db, userId, pin);
    return { signedIn: view(signedIn) };
  });

  handle<Record<string, never>>(CHANNELS.signOut, () => {
    if (db === null) throw new Error('somebody signed out before the database was unlocked');
    if (signedIn !== null) signOutAudit(db, signedIn);
    signedIn = null;
    return {} as Record<string, never>;
  });

  handle<{ people: StaffView[] }>(CHANNELS.staffList, () => {
    if (db === null) throw new Error('the staff list was asked for before the database was unlocked');
    return { people: allStaff(db) };
  });

  handle<{ id: string }>(CHANNELS.staffAdd, (displayName: string, role: string, pin: string) => {
    if (db === null) throw new Error('somebody was added before the database was unlocked');
    return { id: addStaff(db, { displayName, role: role as Role, pin }, atTheLaptop()) };
  });

  handle<Record<string, never>>(CHANNELS.staffSetPin, (userId: string, pin: string) => {
    if (db === null) throw new Error('a PIN was changed before the database was unlocked');
    setPin(db, userId, pin, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.staffSetActive, (userId: string, active: boolean) => {
    if (db === null) throw new Error('an account was changed before the database was unlocked');
    setStaffActive(db, userId, active, atTheLaptop());
    // Somebody switching off the account they are signed in as is
    // refused in setStaffActive, so there is nothing to do here.
    return {} as Record<string, never>;
  });

  // ---------------- the chamber ----------------

  handle<{ view: ChamberView }>(CHANNELS.chamberOpen, (visitId: string) => {
    if (db === null) throw new Error('a consultation was opened before the database was unlocked');
    openEncounter(db, visitId, atTheLaptop());
    return { view: chamberView(db, visitId) };
  });

  handle<{ view: ChamberView }>(CHANNELS.chamberView, (visitId: string) => {
    if (db === null) throw new Error('a consultation was read before the database was unlocked');
    requireClinicalRole(atTheLaptop(), 'open a consultation');
    return { view: chamberView(db, visitId) };
  });

  handle<{ questions: VitalsQuestion[] }>(CHANNELS.vitalsSave, (visitId: string, input: VitalsInput) => {
    if (db === null) throw new Error('vitals were saved before the database was unlocked');
    saveVitals(db, visitId, input, atTheLaptop());
    return { questions: questionsAbout(input) };
  });

  handle<Record<string, never>>(CHANNELS.encounterSaveDraft, (encounterId: string, draft: EncounterDraft) => {
    if (db === null) throw new Error('a consultation was saved before the database was unlocked');
    saveDraft(db, encounterId, draft, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.encounterMedications, (encounterId: string, lines: MedicationInput[]) => {
    if (db === null) throw new Error('a prescription was written before the database was unlocked');
    setMedications(db, encounterId, lines, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.encounterInvestigations, (encounterId: string, names: string[]) => {
    if (db === null) throw new Error('tests were ordered before the database was unlocked');
    setInvestigations(db, encounterId, names, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.encounterConfirm, (encounterId: string) => {
    if (db === null) throw new Error('a consultation was confirmed before the database was unlocked');
    confirmEncounter(db, encounterId, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.encounterUnconfirm, (encounterId: string, reason: string | null) => {
    if (db === null) throw new Error('a confirmation was undone before the database was unlocked');
    unconfirmEncounter(db, encounterId, atTheLaptop(), reason);
    return {} as Record<string, never>;
  });

  // ---------------- the printed prescription ----------------

  handle<{ view: PrescriptionView }>(CHANNELS.prescriptionView, (visitId: string) => {
    if (db === null) throw new Error('a prescription was built before the database was unlocked');
    requireClinicalRole(atTheLaptop(), 'print a prescription');
    return { view: buildPrescription(db, installDir, visitId) };
  });

  handle<{ status: PrescriptionStatus }>(CHANNELS.prescriptionStatus, () => {
    if (db === null) throw new Error('the letterhead was checked before the database was unlocked');
    const outcome = loadPrescriptionConfig(installDir);
    return {
      status: {
        blocksLiveUse: outcome.blocksLiveUse,
        problems: outcome.problems,
        path: prescriptionPath(installDir),
        demo: dataMode(db) === 'demo',
      },
    };
  });

  handle<Record<string, never>>(CHANNELS.prescriptionPrinted, (visitId: string) => {
    if (db === null) throw new Error('a printing was recorded before the database was unlocked');
    recordPrescriptionPrinted(db, visitId, atTheLaptop());
    return {} as Record<string, never>;
  });

  // ---------------- photographs of paper ----------------

  handle<{ attachments: AttachmentRow[] }>(CHANNELS.attachmentsFor, (patientId: string) => {
    if (db === null) throw new Error('attachments were listed before the database was unlocked');
    requireClinicalRole(atTheLaptop(), 'look at a patient\u2019s papers');
    return { attachments: attachmentsFor(db, patientId) };
  });

  handle<{ dataUrl: string; view: AttachmentRow }>(CHANNELS.attachmentContent, (id: string) => {
    if (db === null) throw new Error('an attachment was opened before the database was unlocked');
    requireClinicalRole(atTheLaptop(), 'look at a patient\u2019s papers');
    const { content, contentType, view } = attachmentContent(db, id);
    return { dataUrl: `data:${contentType};base64,${content.toString('base64')}`, view };
  });

  /**
   * Adding pictures from the laptop: a file the doctor has copied off
   * a phone or a scanner. The tablet's camera is the usual way in;
   * this is the way in when the paper never reached the desk.
   */
  handleAsync<{ added: number }>(CHANNELS.attachmentAdd,
    async (patientId: string, visitId: string | null, kind: AttachmentKind, caption: string | null) => {
      if (db === null) throw new Error('an attachment was added before the database was unlocked');
      const actor = atTheLaptop();
      requireClinicalRole(actor, 'add a photograph to the record');

      const chosen = await dialog.showOpenDialog({
        title: 'Choose the photographs to file',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Photographs', extensions: ['jpg', 'jpeg', 'png'] }],
      });
      if (chosen.canceled) return { added: 0 };

      const consent = loadConsentConfig(installDir);
      let added = 0;
      for (const path of chosen.filePaths) {
        const content = readFileSync(path);
        const lower = path.toLowerCase();
        addAttachment(db, {
          patientId, visitId, kind, caption,
          documentDate: null,
          content,
          contentType: lower.endsWith('.png') ? 'image/png' : 'image/jpeg',
          width: null, height: null, source: 'laptop',
        }, actor, { consentVersion: consent.config?.version ?? null });
        added += 1;
      }
      return { added };
    });

  handle<Record<string, never>>(CHANNELS.attachmentRemove, (id: string, reason: string) => {
    if (db === null) throw new Error('an attachment was removed before the database was unlocked');
    removeAttachment(db, id, reason, atTheLaptop());
    return {} as Record<string, never>;
  });

  handle<Record<string, never>>(CHANNELS.redFlagAcknowledge, (eventId: string) => {
    if (db === null) throw new Error('an alert was acknowledged before the database was unlocked');
    // Milestone 2 has no sign-in yet, so the acknowledgement is
    // recorded against the front desk role with no named person. From
    // milestone 9 this becomes the assistant who is signed in.
    acknowledgeRedFlag(db, eventId, actor);
    return {} as Record<string, never>;
  });
}

/**
 * The same as handle(), for the few things that have to wait for
 * something - a file dialog, a disk read. Kept separate so the
 * ordinary case stays as plain as it is.
 */
function handleAsync<T extends object>(channel: string, fn: (...args: never[]) => Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, ...(await fn(...(args as never[]))) } as Result<T>;
    } catch (error) {
      if (error instanceof ChamberRecallError) {
        console.error(`[${channel}] ${error.name}: ${error.message}`);
        return { ok: false, userMessage: error.userMessage, whatToDo: error.whatToDo, technical: String(error.stack ?? error) };
      }
      console.error(`[${channel}] unexpected failure`, error);
      return {
        ok: false,
        userMessage: 'Something in the program went wrong and this action did not complete.',
        whatToDo: 'Nothing was saved. Write down what you were doing, close the program and open it again. If it keeps happening, report it before entering more patients.',
        technical: String((error as Error)?.stack ?? error),
      };
    }
  });
}

function createWindow(): void {
  // 1366x768 is the screen the Recall Card has to fit on without
  // scrolling, so that is what the window opens at.
  const window = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    title: 'Chamber Recall',
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.loadFile(join(__dirname, '..', '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  installDir = dataDir(join(app.getPath('userData'), 'data'));
  console.log(`Chamber Recall data folder: ${installDir}`);
  console.log(`Database file: ${dbPath(installDir)}`);
  registerHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  void (async () => {
    await tabletServer?.close();
    tabletServer = null;
    db?.close();
    db = null;
    app.quit();
  })();
});
