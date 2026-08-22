// ===================================================================
// The application process.
// ===================================================================
import { app, BrowserWindow, ipcMain } from 'electron';
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

let db: Db | null = null;
let installDir = '';

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

  handle<Record<string, never>>(CHANNELS.redFlagAcknowledge, (eventId: string) => {
    if (db === null) throw new Error('an alert was acknowledged before the database was unlocked');
    // Milestone 2 has no sign-in yet, so the acknowledgement is
    // recorded against the front desk role with no named person. From
    // milestone 9 this becomes the assistant who is signed in.
    acknowledgeRedFlag(db, eventId, { id: null, role: 'front_desk' });
    return {} as Record<string, never>;
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
  db?.close();
  db = null;
  app.quit();
});
