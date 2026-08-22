// ===================================================================
// The application process.
// ===================================================================
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { CHANNELS, type InstallationStatus, type DatabaseSummary, type Result } from '../shared/ipc';
import { ChamberRecallError } from '../shared/errors';
import { dataDir, dbPath } from './paths';
import { provision, openWithPassphrase, isProvisioned } from './db/provision';
import { dataMode, getMeta, type Db } from './db/open';
import { recentAudit } from './db/audit';

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

    return {
      summary: {
        dataMode: dataMode(db),
        createdAt: getMeta(db, 'created_at'),
        seededAt: getMeta(db, 'seeded_at'),
        counts,
        recentAudit: recentAudit(db, 25).map(({ details_json, actor_id, ...rest }) => rest),
      },
    };
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
