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
import { localDate, nowIso } from '../db/clock';
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
import { signIn as verifySignIn, actorOf, SignInError, type SignedIn } from '../auth/session';
import { deskSignInList, needsSetup } from '../auth/staff';
import { deskKeys, deskPeopleWithoutOfflineKeys } from '../auth/offlinePin';
import { searchPatients } from '../patients/search';
import { buildDirectory } from '../patients/directory';
import { receiveDeskArrival } from '../queue/deskArrival';
import { deskSignal } from '../queue/deskSignal';
import { recordNoAnswer } from '../queue/noAnswer';
import { registerPatient } from '../patients/register';
import { registerArrival } from '../queue/register';
import { addAttachment, type AttachmentKind } from '../attachments/store';

/**
 * Who is signed in on each paired tablet, by device id.
 *
 * Memory only. Closing the program on the laptop signs every tablet
 * out, which is the right end-of-evening behaviour and also means a
 * crash can never leave somebody's name attached to a tablet they
 * walked away from.
 */
const deskSessions = new Map<string, SignedIn>();
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
  /**
   * Which chamber the NEXT tablet to pair belongs to. Set on the
   * laptop, because the doctor knows which desk the thing in his hand
   * is going to sit on. Null means the laptop's own chamber, which is
   * right for an installation with only one.
   */
  pairingChamberId: string | null;
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
        // Which chamber this tablet is for was decided on the laptop,
        // not here. Falling back to the laptop's own chamber keeps a
        // single-chamber installation working with nothing to set.
        const chamberId = desk.chamberForNextTablet ?? activeChamberId(db);
        if (chamberId === null) {
          sendJson(response, 400, {
            error: 'No chamber has been set up on the laptop yet.',
            whatToDo: 'On the laptop, open today\'s list and choose a chamber, then pair the tablet again.',
          });
          return;
        }
        const token = desk.pair(db, String(body.code ?? ''), String(body.label ?? 'front desk tablet'), chamberId);
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

    // ---- who is at the desk ----
    //
    // The tablet is a shared device on a desk. Pairing says the tablet
    // is allowed to talk to the laptop; it says nothing about which
    // assistant is holding it, and "which assistant" is what goes into
    // the record beside every answer they type.
    //
    // So the person signs in with their PIN once, and the laptop
    // remembers it against that device. Nothing is written by a tablet
    // that nobody has signed in on: it is refused with a message
    // saying so, and the tablet keeps it in its buffer until somebody
    // does - so a laptop restart in the middle of an evening costs one
    // sign-in and loses nothing.
    if (path === '/api/signin') {
      const body = (await readBody(request)) as { userId?: string; pin?: string };
      try {
        const who = verifySignIn(db, String(body.userId ?? ''), String(body.pin ?? ''));
        deskSessions.set(device.id, who);
        sendJson(response, 200, { signedIn: { id: who.id, displayName: who.displayName, role: who.role } });
      } catch (error) {
        const bn = error instanceof SignInError ? error.bn : null;
        sendJson(response, 401, {
          error: error instanceof ChamberRecallError ? error.userMessage : 'That did not work.',
          whatToDo: error instanceof ChamberRecallError ? error.whatToDo : 'Try again.',
          errorBn: bn?.userMessage ?? null,
          whatToDoBn: bn?.whatToDo ?? null,
        });
      }
      return;
    }

    // What lets the front desk into their own tablet on the evening the
    // laptop is at the other chamber. It sits up here, above the line
    // that refuses everything to a tablet nobody has signed in on, and
    // it has to: this IS how somebody signs in when the laptop cannot
    // be asked. Putting it below that line made the tablet ask the
    // laptop for permission to work without the laptop.
    //
    // What is in it: for FRONT DESK people only, a PBKDF2 verifier over
    // their PIN. Never the doctor's, never the clinical assistant's,
    // and never the scrypt hash this route's neighbour above checks --
    // that has never left the laptop and does not start now.
    //
    // What it does not do: sign anybody in. A tablet opened with it
    // still has no session here, so everything it does is refused and
    // held in its outbox until it signs in for real. It opens a screen.
    // See src/main/auth/offlinePin.ts and src/tablet/deskKeys.ts, which
    // between them say what this protects and what it does not.
    if (path === '/api/desk-keys') {
      sendJson(response, 200, {
        keys: deskKeys(db),
        // Front desk people whose PIN predates offline verifiers. Named
        // rather than left off the list, because the fix -- the doctor
        // setting their PIN again -- is not guessable from a name that
        // is simply missing.
        needPinSetAgain: deskPeopleWithoutOfflineKeys(db),
      });
      return;
    }

    if (path === '/api/signout') {
      deskSessions.delete(device.id);
      sendJson(response, 200, { ok: true });
      return;
    }

    const atTheDesk = deskSessions.get(device.id) ?? null;

    // Before anybody has been given a PIN at all, the tablet carries on
    // as it did before sign-in existed, recording against the
    // placeholder whose name says exactly that. After setup, no.
    const beforeSetup = needsSetup(db);
    const actor = atTheDesk !== null ? actorOf(atTheDesk)
      : beforeSetup ? unassignedActor('front_desk')
      : null;

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
        // Names and roles only. No PIN and no hash here: signing in
        // through this route is checked on the laptop, against the
        // scrypt hash, which never leaves it. (The front desk's second,
        // offline-only verifier is a separate route with its own
        // reasoning -- see /api/desk-keys below. Nothing that opens a
        // record is in either.)
        // The front desk, and nobody else. See deskSignInList.
        people: deskSignInList(db).map((p) => ({ id: p.id, displayName: p.displayName, role: p.role })),
        signedIn: atTheDesk === null ? null
          : { id: atTheDesk.id, displayName: atTheDesk.displayName, role: atTheDesk.role },
        signInRequired: !beforeSetup,
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
        // What the tablet needs in order to keep working once this
        // laptop is out of reach: which chamber it speaks for, and the
        // next serial number in that chamber's register today.
        deskChamber: deskChamberFor(db, device),
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

    // The number was called out and nobody came.
    //
    // Above the sign-in line for the same reason as an arrival: it
    // carries the name of the assistant who called it out, checked
    // against app_user inside, and the laptop may well have been closed
    // and reopened since. Throwing it away for want of a live sign-in
    // would lose a record of something a person really did.
    //
    // Nothing about the patient changes here. Read the top of
    // src/main/queue/noAnswer.ts before touching this: not dropping
    // somebody who was in the toilet is the entire design.
    if (path === '/api/queue/no-answer') {
      const body = (await readBody(request)) as Record<string, unknown>;
      try {
        const got = recordNoAnswer(db, {
          deskRef: String(body.deskRef ?? ''),
          visitId: String(body.visitId ?? ''),
          calledBy: String(body.calledBy ?? ''),
          calledAt: String(body.calledAt ?? nowIso()),
        });
        sendJson(response, 200, got);
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof ChamberRecallError ? error.userMessage
            : 'That could not be written down.',
          whatToDo: error instanceof ChamberRecallError ? error.whatToDo
            : 'Call the next number from the laptop\'s list instead.',
        });
      }
      return;
    }

    // Handled BEFORE the sign-in check below, deliberately.
    //
    // An arrival taken at the desk carries its OWN author: the
    // assistant who was standing there, checked against app_user by
    // receiveDeskArrival. By the time it reaches the laptop, the laptop
    // has usually been closed at one chamber and opened at the other,
    // and the sign-in it was holding in memory went with it. Turning
    // this away for want of a live sign-in would throw away work
    // somebody really did two hours ago, which is the one thing this
    // program must never do.
    // An arrival that happened at the desk before the laptop heard of
    // it. Safe to send twice: see src/main/queue/deskArrival.ts.
    if (path === '/api/queue/desk-arrival') {
      const body = (await readBody(request)) as Record<string, unknown>;
      const chamberId = device.chamberId ?? activeChamberId(db);
      if (chamberId === null) {
        sendJson(response, 400, {
          error: 'This tablet has not been told which chamber it is at.',
          whatToDo: 'On the laptop, open the front desk tablet panel and set this tablet\'s chamber.',
        });
        return;
      }
      try {
        const got = receiveDeskArrival(db, {
          deskRef: String(body.deskRef ?? ''),
          chamberId,
          takenBy: String(body.takenBy ?? ''),
          arrivedAt: String(body.arrivedAt ?? nowIso()),
          visitDate: String(body.visitDate ?? localDate()),
          serialAnnounced: Number(body.serialAnnounced ?? 0),
          patientId: (body.patientId as string | null | undefined) ?? null,
          newPatient: body.newPatient as never,
          visitKind: body.visitKind === 'reports_only' ? 'reports_only' : 'consultation',
          // Only ever the fallback receiver. The author of the record
          // is arrival.takenBy, checked inside receiveDeskArrival.
        }, actor ?? { id: null, role: 'system' });
        sendJson(response, 200, got);
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof ChamberRecallError ? error.userMessage : 'That arrival could not be saved.',
          whatToDo: error instanceof ChamberRecallError ? error.whatToDo
            : 'Add the patient to today\'s list on the laptop by hand.',
        });
      }
      return;
    }

    // Everything below this line writes to a patient's record, so it
    // needs a name against it.
    if (actor === null) {
      sendJson(response, 401, {
        error: 'Nobody is signed in on this tablet.',
        whatToDo: 'Tap your name and type your PIN. Nothing has been lost — the tablet will send it as soon as you do.',
        needsSignIn: true,
      });
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

    // ---- the serial register, at the desk where it belongs ----
    //
    // The brief puts registration on the tablet: it is the front desk
    // that meets the patient, and the paper book this replaces sat on
    // their counter, not in the chamber.
    //
    // These three are the one part of the tablet that CANNOT work
    // offline, and the reason is not laziness. A serial number has to
    // be unique and in order for the whole chamber, and two tablets
    // handing out number 14 from their own buffers would be worse than
    // a tablet that says plainly it cannot reach the laptop. So these
    // go straight out, and the screen says so when they fail.
    // The directory: names and phone numbers, so the desk can tell a
    // returning patient from a new one with the laptop at the other
    // chamber. Nothing else about anybody is in it - see
    // src/main/patients/directory.ts for what that means and why.
    // Asked every few seconds. Kept to a few bytes for that reason.
    if (path === '/api/desk-signal') {
      const chamberId = device.chamberId ?? activeChamberId(db);
      if (chamberId === null) { sendJson(response, 200, null); return; }
      sendJson(response, 200, deskSignal(db, chamberId, localDate()));
      return;
    }

    if (path === '/api/directory') {
      sendJson(response, 200, buildDirectory(db, new Date().toISOString()));
      return;
    }

    if (path === '/api/patients/search') {
      const body = (await readBody(request)) as { query?: string };
      sendJson(response, 200, { results: searchPatients(db, String(body.query ?? '')) });
      return;
    }

    if (path === '/api/patients/register') {
      const body = (await readBody(request)) as Record<string, unknown>;
      try {
        const id = registerPatient(db, {
          fullNameBn: (body.fullNameBn as string | null) ?? null,
          fullNameEn: (body.fullNameEn as string | null) ?? null,
          phone: (body.phone as string | null) ?? null,
          dob: (body.dob as string | null) ?? null,
          approxAgeYears: typeof body.approxAgeYears === 'number' ? body.approxAgeYears : null,
          sex: (body.sex as 'male' | 'female' | 'other' | null) ?? null,
          addressFreeText: (body.addressFreeText as string | null) ?? null,
        }, actor);
        sendJson(response, 200, { id });
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof ChamberRecallError ? error.userMessage : 'That could not be saved.',
          whatToDo: error instanceof ChamberRecallError ? error.whatToDo : 'Check what was typed and try again.',
        });
      }
      return;
    }

    if (path === '/api/queue/arrive') {
      const body = (await readBody(request)) as { patientId?: string; allowSecondVisitToday?: boolean };
      // The TABLET's chamber, not the laptop's. The laptop may be at
      // the other chamber entirely; a serial belongs to the desk the
      // patient is standing at.
      const chamberId = device.chamberId ?? activeChamberId(db);
      if (chamberId === null) {
        sendJson(response, 400, {
          error: 'This tablet has not been told which chamber it is at.',
          whatToDo: 'On the laptop, open the front desk tablet panel and set this tablet\'s chamber.',
        });
        return;
      }
      try {
        const result = registerArrival(db, String(body.patientId ?? ''), chamberId, actor, {
          allowSecondVisitToday: body.allowSecondVisitToday === true,
        });
        sendJson(response, 200, {
          serialNo: result.serialNo,
          visitId: result.visitId,
          alreadyOnListVisitId: result.alreadyOnListVisitId,
        });
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof ChamberRecallError ? error.userMessage : 'That could not be saved.',
          whatToDo: error instanceof ChamberRecallError ? error.whatToDo : 'Try again.',
        });
      }
      return;
    }

    /**
     * A photograph of the paper the patient brought.
     *
     * Sent as base64 inside ordinary JSON rather than as a multipart
     * upload: the tablet has already shrunk it to a few hundred
     * kilobytes, and one way of sending things is easier to keep
     * right than two.
     *
     * This does NOT go through the outbox. Everything else the tablet
     * sends is a few hundred bytes of text and buffers happily; a
     * queue of photographs would fill the tablet's storage and be
     * silently dropped by the browser. So it goes straight out, and if
     * it fails the assistant is told at once - while the paper is
     * still in their hand and can simply be photographed again.
     */
    if (path === '/api/attachments') {
      const body = (await readBody(request)) as {
        visitId?: string; kind?: string; caption?: string | null;
        contentBase64?: string; contentType?: string; width?: number; height?: number;
      };
      const visit = db.prepare('SELECT patient_id AS patientId FROM visit WHERE id = ? AND deleted_at IS NULL')
        .get(String(body.visitId ?? '')) as { patientId: string } | undefined;
      if (visit === undefined) {
        sendJson(response, 400, {
          error: 'That patient is no longer on today\'s list.',
          whatToDo: 'Go back and choose the patient again. The photograph was not saved.',
        });
        return;
      }
      try {
        const consent = loadConsentConfig(dataDir);
        const id = addAttachment(db, {
          patientId: visit.patientId,
          visitId: String(body.visitId ?? ''),
          kind: (body.kind ?? 'report') as AttachmentKind,
          caption: body.caption ?? null,
          documentDate: null,
          content: Buffer.from(String(body.contentBase64 ?? ''), 'base64'),
          contentType: body.contentType === 'image/png' ? 'image/png' : 'image/jpeg',
          width: typeof body.width === 'number' ? body.width : null,
          height: typeof body.height === 'number' ? body.height : null,
          source: 'tablet',
        }, actor, { consentVersion: consent.config?.version ?? null });
        sendJson(response, 200, { id });
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof ChamberRecallError ? error.userMessage : 'The photograph could not be saved.',
          whatToDo: error instanceof ChamberRecallError ? error.whatToDo
            : 'Nothing was saved. The paper is still with the patient — take it again.',
        });
      }
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
        get pairingChamberId() { return desk.chamberForNextTablet; },
        set pairingChamberId(chamberId: string | null) { desk.chamberForNextTablet = chamberId; },
        get pairingLocked() { return desk.locked; },
        close: () => new Promise<void>((done) => server.close(() => done())),
      } as RunningServer);
    });
  });
}

export { IntakeRefusedError };

/**
 * What a tablet needs to hand out serial numbers with no laptop in the
 * room: which chamber it belongs to, and where that chamber's register
 * has got to today.
 *
 * Refreshed every time the laptop is reachable. Between refreshes the
 * tablet counts on from here on its own, which is safe because exactly
 * one tablet does that for one chamber.
 */
export function deskChamberFor(db: Db, device: { chamberId: string | null }):
  { id: string; name: string; nextSerial: number } | null {
  const chamberId = device.chamberId ?? activeChamberId(db);
  if (chamberId === null) return null;
  const row = db.prepare('SELECT id, name FROM chamber WHERE id = ? AND deleted_at IS NULL')
    .get(chamberId) as { id: string; name: string } | undefined;
  if (row === undefined) return null;
  const next = (db.prepare(
    'SELECT COALESCE(max(serial_no), 0) + 1 AS n FROM visit WHERE chamber_id = ? AND visit_date = ?',
  ).get(chamberId, localDate()) as { n: number }).n;
  return { id: row.id, name: row.name, nextSerial: next };
}
