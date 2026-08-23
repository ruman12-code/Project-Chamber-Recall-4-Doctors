// ===================================================================
// The local network server the tablet talks to.
// ===================================================================
// Plain node:http. No framework, because this has eight routes and a
// framework would be a dependency to maintain for the next five years
// in exchange for saving forty lines today.
//
// It listens on the chamber's own network only. There is no internet
// involved at any point: no outbound request, no cloud, no update
// check. If the building's router is unplugged, the laptop and the
// tablet carry on talking to each other.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { networkInterfaces } from 'node:os';
import type { Db } from '../db/open';
import { localDate } from '../db/clock';
import { todaysQueue, activeChamberId, chambers } from '../queue/queue';
import { loadChamberConfig } from '../intake/store';
import { startIntake, saveAnswers, finishIntake, intakeState, factsFor, IntakeRefusedError } from '../intake/session';
import { screenIntake, acknowledgeRedFlag } from '../redflags/store';
import { loadConsentConfig } from '../consent/config';
import { consentState, recordConsent, type ConsentDecision, type ConsentGivenBy, type ConsentMethod } from '../consent/store';
import { dataMode } from '../db/open';
import { consentAudioDir } from '../paths';
import { PairingDesk, deviceForToken, PairingLockedError } from './pairing';
import { unassignedActor } from '../db/users';
import { ChamberRecallError } from '../../shared/errors';

export const DEFAULT_PORT = 8137;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export interface TabletServerOptions {
  db: Db;
  dataDir: string;
  /** Folder holding the built tablet page. */
  webRoot: string;
  port?: number;
}

export interface RunningServer {
  port: number;
  addresses: string[];
  pairingCode: string;
  pairingLocked: boolean;
  close: () => Promise<void>;
}

/** Every address on this machine a tablet could reach it at. */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // A front desk sends a few hundred bytes at a time. Anything this
      // large is a mistake or an attack, and either way is refused.
      if (size > 256 * 1024) { reject(new Error('That was too much data to accept in one go.')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') { resolve({}); return; }
      try { resolve(JSON.parse(text)); } catch { reject(new Error('That message was not readable.')); }
    });
    request.on('error', reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(text);
}

export function startTabletServer(options: TabletServerOptions): Promise<RunningServer> {
  const { db, dataDir, webRoot } = options;
  const port = options.port ?? DEFAULT_PORT;
  const desk = new PairingDesk();

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://tablet.local');
    const path = url.pathname;

    try {
      if (path.startsWith('/api/')) {
        await handleApi(path, request, response);
        return;
      }
      await serveFile(path, response);
    } catch (error) {
      // Nothing fails silently, including out here. The tablet shows
      // whatever plain sentence arrives.
      if (error instanceof ChamberRecallError) {
        sendJson(response, 400, { error: error.userMessage, whatToDo: error.whatToDo });
        return;
      }
      console.error('[tablet server]', error);
      sendJson(response, 500, {
        error: 'Something went wrong on the laptop.',
        whatToDo: 'Nothing was lost. The tablet will try again on its own. If it keeps happening, tell whoever looks after this software.',
      });
    }
  };

  async function serveFile(path: string, response: ServerResponse): Promise<void> {
    const relative = path === '/' ? 'index.html' : path.replace(/^\/+/, '');
    // Never let a path climb out of the folder being served.
    const target = normalize(join(webRoot, relative));
    if (!target.startsWith(normalize(webRoot)) || !existsSync(target)) {
      // Anything unrecognised gets the page, so the tablet can be
      // reloaded at any address without a dead end.
      const index = join(webRoot, 'index.html');
      if (!existsSync(index)) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('The tablet page has not been built. Run: npm run build');
        return;
      }
      const html = await readFile(index);
      response.writeHead(200, { 'content-type': MIME['.html']!, 'cache-control': 'no-store' });
      response.end(html);
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  }

  async function handleApi(path: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' && request.method !== 'GET') {
      sendJson(response, 405, { error: 'That is not something this program accepts.', whatToDo: 'Reload the tablet page.' });
      return;
    }

    // ---- pairing is the one route that does not need a token
    if (path === '/api/pair') {
      const body = (await readBody(request)) as { code?: string; label?: string };
      try {
        const token = desk.pair(db, String(body.code ?? ''), String(body.label ?? 'front desk tablet'));
        sendJson(response, 200, { token });
      } catch (error) {
        sendJson(response, error instanceof PairingLockedError ? 429 : 401, {
          error: error instanceof Error ? error.message : 'That code is not right.',
          whatToDo: error instanceof PairingLockedError
            ? 'Close the program on the laptop and open it again.'
            : `Check the code on the laptop screen. ${desk.attemptsLeft} tries left before pairing locks.`,
        });
      }
      return;
    }

    const token = (request.headers['x-chamber-token'] as string | undefined) ?? null;
    const device = deviceForToken(db, token);
    if (device === null) {
      sendJson(response, 401, {
        error: 'This tablet is not paired with the laptop.',
        whatToDo: 'Enter the code shown on the laptop screen.',
        needsPairing: true,
      });
      return;
    }

    // Everything the tablet does is recorded against the front desk
    // row. Once sign-in exists it becomes whoever is signed in on the
    // tablet; until then the name says plainly that nobody was.
    const actor = unassignedActor('front_desk');

    // ---- everything the tablet needs to work, including offline
    if (path === '/api/session') {
      const config = loadChamberConfig(dataDir);
      const consent = loadConsentConfig(dataDir);
      const chamberId = activeChamberId(db);
      const all = chambers(db);
      const queue = chamberId === null ? [] : todaysQueue(db, chamberId, localDate());

      // Whether each patient has already answered, so a returning
      // patient is not asked the same thing every single visit.
      const withConsent = queue.map((entry) => ({
        ...entry,
        consent: consent.config === null
          ? { careRecord: 'not_asked' as const, research: 'not_asked' as const }
          : (() => {
              const state = consentState(db, entry.patientId, consent.config.version);
              return { careRecord: state.careRecord, research: state.research };
            })(),
      }));

      sendJson(response, 200, {
        device,
        chamber: { id: chamberId, name: all.find((c) => c.id === chamberId)?.name ?? null },
        visitDate: localDate(),
        dataMode: dataMode(db),
        questionnaire: config.questions.questionnaire,
        questionProblems: config.questions.problems,
        rulebook: config.rules.rulebook,
        ruleProblems: config.rules.problems,
        consent: consent.config,
        consentProblems: consent.problems,
        consentBlocksLiveUse: consent.blocksLiveUse,
        queue: withConsent,
      });
      return;
    }

    // The spoken consent, read by a real person. Served from the data
    // folder so the doctor can replace the recording without anyone
    // rebuilding the software.
    if (path.startsWith('/api/consent/audio/')) {
      const name = decodeURIComponent(path.slice('/api/consent/audio/'.length));
      const target = normalize(join(consentAudioDir(dataDir), name));
      if (!target.startsWith(normalize(consentAudioDir(dataDir))) || !existsSync(target)) {
        sendJson(response, 404, {
          error: 'That recording has not been made yet.',
          whatToDo: 'Read the words on the screen aloud to the patient instead.',
        });
        return;
      }
      const body = await readFile(target);
      response.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
      response.end(body);
      return;
    }

    /**
     * Recording what a patient said. Sent through the tablet's buffer
     * like everything else, so it survives a dropped connection - and
     * it is keyed by the visit, so it replays in order ahead of the
     * answers it has to come before.
     */
    if (path === '/api/consent/record') {
      const body = (await readBody(request)) as {
        visitId?: string; kind?: 'care_record' | 'research'; decision?: ConsentDecision;
        givenBy?: ConsentGivenBy; givenByName?: string | null; relationship?: string | null;
        method?: ConsentMethod; language?: 'bn' | 'en'; version?: string;
      };
      const visit = db.prepare('SELECT patient_id AS patientId FROM visit WHERE id = ? AND deleted_at IS NULL')
        .get(String(body.visitId ?? '')) as { patientId: string } | undefined;
      if (visit === undefined) {
        sendJson(response, 400, { error: 'That patient is no longer on today\'s list.', whatToDo: 'Go back and choose the patient again.' });
        return;
      }
      const consent = loadConsentConfig(dataDir);
      recordConsent(db, {
        patientId: visit.patientId,
        kind: body.kind === 'research' ? 'research' : 'care_record',
        // The version the laptop is actually holding, not one the
        // tablet asserts: a tablet running from a stale cache must not
        // be able to record consent against wording nobody approved.
        version: consent.config?.version ?? String(body.version ?? ''),
        decision: body.decision === 'declined' ? 'declined' : body.decision === 'withdrawn' ? 'withdrawn' : 'given',
        givenBy: body.givenBy ?? 'self',
        givenByName: body.givenByName ?? null,
        relationship: body.relationship ?? null,
        method: body.method ?? 'screen_only',
        language: body.language === 'en' ? 'en' : 'bn',
      }, actor);
      sendJson(response, 200, { ok: true });
      return;
    }

    // Everything the tablet sends is keyed by the VISIT, never by the
    // intake. The tablet may be offline when it starts asking, so it
    // cannot know an intake id yet - and starting an intake is
    // idempotent, so the laptop can work it out on arrival. This is
    // what lets the whole buffered queue be replayed in order without
    // any of it needing to know what happened on the laptop.
    if (path === '/api/intake/start') {
      const body = (await readBody(request)) as { visitId?: string };
      const intakeId = startIntake(db, String(body.visitId ?? ''), actor);
      sendJson(response, 200, { intakeId, state: intakeState(db, intakeId) });
      return;
    }

    if (path === '/api/intake/answers') {
      const body = (await readBody(request)) as {
        visitId?: string;
        answers?: Array<{ questionKey: string; value: string | null; freeText: string | null; skipped: boolean }>;
      };
      const intakeId = startIntake(db, String(body.visitId ?? ''), actor);
      saveAnswers(db, intakeId, body.answers ?? []);

      // The laptop is the authority on red flags. The tablet checks the
      // same rules itself so the warning appears instantly even with no
      // wifi, but what gets written down is decided here, from the
      // answers as they actually arrived.
      const config = loadChamberConfig(dataDir);
      let screening = null;
      if (config.rules.rulebook !== null) {
        const outcome = screenIntake(db, config.rules.rulebook, intakeId, actor);
        screening = {
          firedFlags: outcome.firedFlags,
          screeningIncomplete: outcome.screeningIncomplete,
          missingQuestions: outcome.missingQuestions,
        };
      }
      sendJson(response, 200, { state: intakeState(db, intakeId), screening });
      return;
    }

    if (path === '/api/intake/finish') {
      const body = (await readBody(request)) as { visitId?: string };
      finishIntake(db, startIntake(db, String(body.visitId ?? ''), actor), actor);
      sendJson(response, 200, { ok: true });
      return;
    }

    // Acknowledged by which rule fired, not by the alert's id: the
    // tablet may have shown the warning while offline, working from its
    // own copy of the rules, and never have seen an id at all.
    if (path === '/api/redflag/ack') {
      const body = (await readBody(request)) as { visitId?: string; ruleId?: string; ruleVersion?: string };
      const intakeId = startIntake(db, String(body.visitId ?? ''), actor);
      const event = db.prepare(
        'SELECT id FROM red_flag_event WHERE intake_id = ? AND rule_id = ? AND rule_version = ?',
      ).get(intakeId, String(body.ruleId ?? ''), String(body.ruleVersion ?? '')) as { id: string } | undefined;
      if (event === undefined) {
        // The answers that would have fired it have not arrived yet, or
        // the laptop did not agree that it fires. Either way this is not
        // an error the assistant can do anything about, and the alert
        // was still shown - which is the direction that matters.
        sendJson(response, 200, { ok: true, noSuchAlert: true });
        return;
      }
      acknowledgeRedFlag(db, event.id, actor);
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, {
      error: 'The tablet asked for something this program does not have.',
      whatToDo: 'Reload the tablet page. If it keeps happening the laptop and the tablet are running different versions.',
    });
  }

  const server: Server = createServer((request, response) => { void handler(request, response); });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      // The port actually bound, which is not always the one asked for:
      // passing 0 means "any free port", and reporting back the 0 would
      // send the tablet to an address that cannot exist.
      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        port: boundPort,
        addresses: lanAddresses(),
        get pairingCode() { return desk.currentCode; },
        get pairingLocked() { return desk.locked; },
        close: () => new Promise<void>((done) => server.close(() => done())),
      } as RunningServer);
    });
  });
}

export { IntakeRefusedError };
