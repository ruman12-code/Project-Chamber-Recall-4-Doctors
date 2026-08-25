import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, outbox, storedToken, NeedsPairingError, LaptopUnreachableError } from './api';
import { Outbox, type OutboxStatus } from './outbox';
import { storeDirectory, forgetDirectory } from './directory';
import { syncFromLaptop, forgetSerials } from './serials';
import { armChime, chime, chimeIsArmed } from './chime';
import { CalledIn } from './screens/CalledIn';
import type { DeskSignal } from './api';
import { Pair } from './screens/Pair';
import { DeskSignIn, type DeskPerson } from './screens/DeskSignIn';
import {
  storeDeskKeys, loadDeskKeys, forgetDeskKeys, clearOfflineFailures, type DeskKeys,
} from './deskKeys';
import { PickPatient, type QueueEntryWithConsent } from './screens/PickPatient';
import { Arrive } from './screens/Arrive';
import { Papers } from './screens/Papers';
import { Ask } from './screens/Ask';
import { Alarm } from './screens/Alarm';
import { Consent, type ConsentPart, type ConsentMethod, type ConsentGivenBy } from './screens/Consent';
import { nextQuestion, expectedQuestionCount, type Questionnaire } from '../main/intake/flow';
import { evaluateRulebook } from '../main/redflags/evaluate';
import type { Rulebook } from '../main/redflags/types';
import type { Facts } from '../main/rules/facts';


/** Fifteen minutes with nobody touching it and the screen goes back. */
const IDLE_CLEAR_MS = 15 * 60 * 1000;
const SESSION_KEY = 'chamber-recall.session.v1';
/** Which chamber this tablet is at. Kept so the desk still knows after
 *  the tablet has been switched off and the laptop is elsewhere. */
const DESK_CHAMBER_KEY = 'chamber-recall.deskChamber.v1';
const DRAFT_KEY = 'chamber-recall.draft.v1';
const LANG_KEY = 'chamber-recall.lang.v1';

/**
 * Bumped whenever the shape of what the tablet keeps changes.
 *
 * The tablet holds a copy of the last session so it can work with no
 * wifi. After the laptop's software is updated that copy is the OLD
 * shape, and code expecting a new field walks straight into it - which
 * is exactly what happened when consent was added: every tablet with a
 * cached session simply stopped responding when a patient was tapped.
 *
 * A cache from a different version is therefore ignored rather than
 * trusted. The cost is one trip to the laptop after an update; the
 * alternative is a tablet that looks fine and does nothing.
 */
const CACHE_SHAPE = 4;

interface Answer { value: string | null; freeText: string | null; skipped: boolean }

type ConsentStanding = 'given' | 'declined' | 'withdrawn' | 'not_asked' | 'out_of_date';

interface Draft {
  visitId: string;
  serialNo: number;
  name: string;
  patient: { ageYears: number | null; sex: string | null };
  answers: Record<string, Answer>;
  presented: string[];
  acknowledged: string[];
  touchedAt: number;
  /**
   * Where this patient is in being asked permission. Nothing is asked
   * about their health until this reaches 'asking'.
   */
  stage: 'consent_care' | 'consent_research' | 'asking' | 'declined';
  /** Here to show a test the doctor asked for last time, so the
   *  questions about a new complaint are not asked at all. */
  reportsOnly: boolean;
}

interface ConsentConfig {
  version: string;
  approvedBy: string;
  approvedOn: string;
  careRecord: ConsentPart;
  research: ConsentPart;
}

interface CachedSession {
  shape: number;
  questionnaire: Questionnaire | null;
  rulebook: Rulebook | null;
  queue: QueueEntryWithConsent[];
  chamberName: string | null;
  visitDate: string;
  dataMode: 'demo' | 'live';
  consent: ConsentConfig | null;
  consentBlocksLiveUse: Array<{ reason: string; whatToDo: string }>;
  /** Who may sign in on the tablet, and who currently is. */
  people: DeskPerson[];
  signedIn: DeskPerson | null;
  signInRequired: boolean;
  cachedAt: string;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw) as T;
  } catch { return null; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* still works, just not across reloads */ }
}

export function App() {
  const [paired, setPaired] = useState(storedToken() !== null);
  const [session, setSession] = useState<CachedSession | null>(() => {
    const cached = readJson<CachedSession>(SESSION_KEY);
    return cached !== null && cached.shape === CACHE_SHAPE ? cached : null;
  });
  const [draft, setDraft] = useState<Draft | null>(() => {
    const cached = readJson<Draft>(DRAFT_KEY);
    // A half-finished intake from an older version is left alone rather
    // than resumed into code that no longer matches it. Nothing is
    // lost: every answer already went to the laptop or into the outbox.
    return cached !== null && typeof cached.stage === 'string' ? cached : null;
  });
  const [bn, setBn] = useState(() => (localStorage.getItem(LANG_KEY) ?? 'bn') === 'bn');
  const [status, setStatus] = useState<OutboxStatus>(outbox.status());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  /** The serial register: registering an arrival, and the number given. */
  const [arriving, setArriving] = useState(false);
  const [justGiven, setJustGiven] = useState<{ serialNo: number; name: string } | null>(null);
  /** Which chamber this tablet speaks for, and where its register had
   *  got to the last time the laptop was reachable. */
  const [deskChamber, setDeskChamber] = useState<{ id: string; name: string; nextSerial: number } | null>(
    () => readJson<{ id: string; name: string; nextSerial: number }>(DESK_CHAMBER_KEY),
  );
  /** The doctor has called somebody in and the desk has not yet said
   *  they sent them. Takes the whole screen while it is set. */
  const [called, setCalled] = useState<
    (NonNullable<DeskSignal['inChamber']>
      & { nextUp?: boolean; noAnswer?: number; onlyOneWaiting?: boolean }) | null>(null);
  /** The last state of the room this tablet has already announced, so
   *  it announces a change rather than announcing every few seconds. */
  const announced = useRef<string | null>(null);
  const [showingPapers, setShowingPapers] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Opened without the laptop.
   *
   * In memory, never written down. Two reasons, and both matter: the
   * PIN is in here so that the moment the laptop is reachable the
   * tablet can sign in to it for real and stop holding the outbox; and
   * a tablet that is switched off and on has to ask again, which is the
   * same rule it already followed when the laptop restarted mid-evening.
   *
   * This is not a signed-in state as far as the laptop is concerned.
   * Nothing opened this way is accepted by the laptop until the real
   * sign-in below has happened. It opens the kiosk; it signs nothing.
   */
  const [offlineDesk, setOfflineDesk] = useState<{ who: DeskPerson; pin: string } | null>(null);
  /**
   * What this tablet has been given for opening itself with no laptop.
   *
   * Held here rather than read by the sign-in screen, because the first
   * time a tablet is paired the sign-in screen is already on screen
   * before the keys have finished arriving. Read once for a tablet that
   * was switched off and on, and replaced every time the laptop is
   * reached, so a PIN the doctor changed this afternoon stops working
   * here the moment the laptop is next in reach.
   */
  const [deskKeys, setDeskKeys] = useState<DeskKeys | null>(null);
  /** The same thing, readable from inside refresh, which is built once
   *  and would otherwise go on seeing the value this was when the
   *  tablet started -- null, forever, and the real sign-in would never
   *  be made. */
  const offlineDeskRef = useRef<{ who: DeskPerson; pin: string } | null>(null);
  useEffect(() => { offlineDeskRef.current = offlineDesk; }, [offlineDesk]);

  useEffect(() => { outbox.start(); return outbox.onChange(setStatus); }, []);
  // A tablet switched on with the laptop already away has only what it
  // was given last time. Read before anything is asked of the wifi.
  useEffect(() => {
    void (async () => {
      const token = storedToken();
      if (token === null) return;
      setDeskKeys(await loadDeskKeys(token));
    })();
  }, [paired]);
  useEffect(() => { localStorage.setItem(LANG_KEY, bn ? 'bn' : 'en'); }, [bn]);
  useEffect(() => { if (draft !== null) writeJson(DRAFT_KEY, draft); }, [draft]);

  /**
   * Fetches the questions, the rules and today's list, and keeps a copy
   * on the tablet. The copy is what makes the tablet work with no wifi:
   * the questions carry on appearing and the rules carry on being
   * checked, from what was last known.
   */
  const refresh = useCallback(async () => {
    try {
      // Somebody got into this tablet without the laptop, and the
      // laptop may be back. Sign in to it for real BEFORE asking for
      // the session -- with the PIN they actually typed, checked
      // against the scrypt hash that never left the laptop. Doing it
      // first is not tidiness: the session that comes back a line later
      // is what the screen believes about who is holding this tablet,
      // and signing in after reading it threw the desk back out to the
      // sign-in screen for twenty seconds in the middle of an evening.
      //
      // Until this succeeds the outbox is refused and holds, which is
      // correct: the laptop decides whose name goes on a record, and it
      // has not yet agreed to this one.
      const opened = offlineDeskRef.current;
      if (opened !== null) {
        try {
          await api.post('/api/signin', { userId: opened.who.id, pin: opened.pin });
          clearOfflineFailures();
          setOfflineDesk(null);
        } catch (caught) {
          // Could not be asked at all: stay as we are and try again on
          // the next refresh. Anything else is an answer -- the PIN was
          // changed on the laptop since, or the person was switched off
          // -- and the desk has to sign in again, which dropping the
          // offline session is what makes the screen ask for.
          if (!(caught instanceof LaptopUnreachableError)) setOfflineDesk(null);
        }
      }

      const raw = await api.session() as unknown as {
        questionnaire: Questionnaire | null; rulebook: Rulebook | null;
        queue: QueueEntryWithConsent[]; chamber: { name: string | null }; visitDate: string;
        dataMode: 'demo' | 'live'; consent: ConsentConfig | null;
        consentBlocksLiveUse: Array<{ reason: string; whatToDo: string }>;
        people?: DeskPerson[]; signedIn?: DeskPerson | null; signInRequired?: boolean;
        deskChamber?: { id: string; name: string; nextSerial: number } | null;
      };
      const next: CachedSession = {
        shape: CACHE_SHAPE,
        questionnaire: raw.questionnaire, rulebook: raw.rulebook, queue: raw.queue,
        chamberName: raw.chamber.name, visitDate: raw.visitDate,
        dataMode: raw.dataMode, consent: raw.consent,
        consentBlocksLiveUse: raw.consentBlocksLiveUse ?? [],
        people: raw.people ?? [],
        signedIn: raw.signedIn ?? null,
        signInRequired: raw.signInRequired === true,
        cachedAt: new Date().toISOString(),
      };
      setSession(next);
      writeJson(SESSION_KEY, next);
      setLoadError(null);

      // Everything the desk needs to keep working once this laptop is
      // out of reach. Taken while it IS in reach, every single time.
      const desk = raw.deskChamber ?? null;
      setDeskChamber(desk);
      if (desk !== null) {
        writeJson(DESK_CHAMBER_KEY, desk);
        // The laptop's count is the truth, but ONLY when the laptop has
        // seen everything this tablet has given out. With arrivals
        // still waiting in the outbox the laptop's number is behind,
        // and moving the count back to it would hand the next patient a
        // number somebody in the room has already been told.
        if (outbox.status().pending === 0) {
          syncFromLaptop(desk.id, raw.visitDate, desk.nextSerial);
        }
      }
      void (async () => {
        const token = storedToken();
        if (token === null) return;
        try {
          const directory = await api.directory();
          await storeDirectory(token, directory);
        } catch {
          // An out-of-date directory is worth keeping. It is only ever
          // used to ask "have I seen this name before", and the laptop
          // decides who anybody actually is.
        }
        try {
          const fresh = { ...await api.deskKeys(), takenAt: new Date().toISOString() };
          await storeDeskKeys(token, fresh);
          setDeskKeys(fresh);
        } catch {
          // Same reasoning: what is already here still opens the tablet
          // on the evening the laptop is at the other chamber. A PIN the
          // doctor has since changed stops working the next time this
          // succeeds, which is the next time the laptop is reachable.
        }
      })();

    } catch (caught) {
      if (caught instanceof NeedsPairingError) {
        // Disconnected on the laptop, which is what somebody does the
        // moment a tablet goes missing. Everything this tablet was
        // holding about patients goes now: the list of names and
        // numbers, and the count of serials. The token goes with it, so
        // even a copy of the storage taken afterwards cannot be read.
        forgetDirectory();
        forgetSerials();
        forgetDeskKeys();
        setDeskKeys(null);
        setOfflineDesk(null);
        setDeskChamber(null);
        try { localStorage.removeItem(DESK_CHAMBER_KEY); } catch { /* nothing to do */ }
        setPaired(false);
        return;
      }
      // Not being able to reach the laptop is not an error worth
      // stopping for when there is a copy already on the tablet.
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    if (!paired) return;
    void refresh();
    // Who the doctor has called in. Asked far more often than the rest
    // of the session, because between the doctor pressing Call in and
    // the patient walking through the door there is a person waiting in
    // an empty room.
    const signalTimer = setInterval(() => {
      void (async () => {
        try {
          const signal = await api.deskSignal();
          if (signal === null) return;
          // The first answer after this tablet started is not news. It
          // is the state of the room, which the assistant can see.
          if (announced.current === null) { announced.current = signal.at; return; }
          if (signal.at === announced.current) return;
          announced.current = signal.at;
          if (signal.inChamber !== null) {
            setCalled(signal.inChamber);
            chime();
          } else if (signal.nextWaiting !== null) {
            // The doctor has finished with somebody and the room is
            // empty. The desk should not have to wait for him to press
            // anything: the next serial comes up by itself, because the
            // patient after this one is what the desk does next every
            // single time.
            //
            // Never out of turn -- this IS the turn, by definition.
            setCalled({ ...signal.nextWaiting, outOfTurn: false, nextUp: true });
            chime();
          } else {
            // Nobody with the doctor and nobody waiting. The evening is
            // caught up.
            setCalled(null);
            void refresh();
          }
        } catch { /* the laptop is away; the desk carries on */ }
      })();
    }, 3000);

    const timer = setInterval(() => { void refresh(); }, 20000);
    return () => { clearInterval(timer); clearInterval(signalTimer); };
  }, [paired, refresh]);

  // ---- kiosk-ish: fill the screen, and do not offer a way out of it
  useEffect(() => {
    const goFullscreen = () => {
      if (document.fullscreenElement === null) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      // The same touch arms the sound. Android refuses audio until a
      // page has been touched, and this is the first touch there is.
      armChime();
      window.removeEventListener('pointerdown', goFullscreen);
    };
    window.addEventListener('pointerdown', goFullscreen);
    const blockMenu = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', blockMenu);
    return () => { window.removeEventListener('pointerdown', goFullscreen); window.removeEventListener('contextmenu', blockMenu); };
  }, []);

  /**
   * Nothing of one patient is ever left on screen for the next one.
   *
   * What is cleared is the SCREEN, not the answers: everything already
   * given is on the laptop or in the outbox waiting to go. An intake
   * left half done stays half done and is marked as such, because
   * throwing away what a patient already said would be the one thing
   * this project refuses to do.
   */
  const clearScreen = useCallback(() => {
    setDraft(null);
    setFinished(false);
    setShowingPapers(false);
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  const touch = useCallback(() => {
    if (idleTimer.current !== null) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(clearScreen, IDLE_CLEAR_MS);
  }, [clearScreen]);

  useEffect(() => {
    touch();
    const events = ['pointerdown', 'keydown'];
    for (const event of events) window.addEventListener(event, touch);
    return () => { for (const event of events) window.removeEventListener(event, touch); };
  }, [touch]);

  // ---- the red flag check, run on the tablet so it fires with no wifi
  const facts: Facts = useMemo(() => ({
    answers: draft?.answers ?? {},
    patient: draft?.patient ?? { ageYears: null, sex: null },
  }), [draft]);

  const firing = useMemo(() => {
    if (session?.rulebook == null || draft === null) return [];
    return evaluateRulebook(session.rulebook, facts).fired
      .filter((rule) => !draft.acknowledged.includes(`${rule.id}@${rule.version}`))
      .map((rule) => ({ ruleId: rule.id, ruleVersion: rule.version, bn: rule.message.bn, en: rule.message.en }));
  }, [session, facts, draft]);

  if (!paired) return <Pair onPaired={() => { setPaired(true); void refresh(); }} />;

  // Nobody writes anything from a tablet that nobody has signed in on.
  // The laptop refuses it anyway; asking here means the assistant finds
  // out at the start of the evening rather than after typing a history.
  if (session !== null && session.signInRequired && session.signedIn === null && offlineDesk === null) {
    return <DeskSignIn people={session.people} bn={bn} deskKeys={deskKeys}
      onSignedIn={() => { void refresh(); }}
      onOffline={(who, pin) => { setOfflineDesk({ who, pin }); }} />;
  }

  const questionnaire = session?.questionnaire ?? null;
  const consentConfig = session?.consent ?? null;

  /**
   * A live chamber does not ask anybody anything until the consent
   * wording has been approved. A practice database runs anyway, loudly
   * labelled, so the rest of the software can be built and shown.
   */
  const consentUnusable = consentConfig === null
    || (session?.dataMode === 'live' && (session?.consentBlocksLiveUse.length ?? 0) > 0);

  function startWith(entry: QueueEntryWithConsent) {
    // Permission first, and only what still needs asking. A patient who
    // agreed on an earlier visit is not asked again unless the wording
    // itself has changed.
    // Defensive: a queue entry from an older laptop has no consent on
    // it, and the safe reading of "I do not know" is to ask.
    const standing = entry.consent ?? { careRecord: 'not_asked', research: 'not_asked' };
    const stage: Draft['stage'] =
      standing.careRecord === 'given'
        ? (standing.research === 'not_asked' || standing.research === 'out_of_date'
            ? 'consent_research' : 'asking')
        : 'consent_care';

    outbox.add('/api/intake/start', { visitId: entry.visitId });
    setDraft({
      visitId: entry.visitId,
      serialNo: entry.serialNo,
      name: entry.nameBn ?? entry.nameEn ?? '',
      patient: { ageYears: entry.ageYears, sex: entry.sex },
      answers: {}, presented: [], acknowledged: [], touchedAt: Date.now(),
      stage,
      reportsOnly: entry.visitKind === 'reports_only',
    });
    setFinished(false);
  }

  function decideConsent(
    kind: 'care_record' | 'research', decision: 'given' | 'declined',
    method: ConsentMethod, givenBy: ConsentGivenBy,
  ) {
    if (draft === null) return;
    outbox.add('/api/consent/record', {
      visitId: draft.visitId, kind, decision, method, givenBy,
      language: bn ? 'bn' : 'en', version: session?.consent?.version ?? '',
    });

    if (kind === 'care_record') {
      // Refusing to have a history kept ends it there. No questions are
      // asked, the serial stands, and the doctor sees them as before.
      setDraft({ ...draft, stage: decision === 'declined' ? 'declined' : 'consent_research', touchedAt: Date.now() });
      return;
    }
    setDraft({ ...draft, stage: 'asking', touchedAt: Date.now() });
  }

  function record(questionKey: string, answer: Answer) {
    if (draft === null) return;
    const updated: Draft = {
      ...draft,
      answers: { ...draft.answers, [questionKey]: answer },
      presented: draft.presented.includes(questionKey) ? draft.presented : [...draft.presented, questionKey],
      touchedAt: Date.now(),
    };
    setDraft(updated);
    outbox.add('/api/intake/answers', {
      visitId: draft.visitId,
      answers: [{ questionKey, value: answer.value, freeText: answer.freeText, skipped: answer.skipped }],
    });
  }

  function finish() {
    if (draft === null) return;
    outbox.add('/api/intake/finish', { visitId: draft.visitId });
    // The paper the patient brought is asked about after the
    // questions, not before: they have their bag open by then, and a
    // patient who brought nothing gets one tap rather than a screen
    // they have to work out.
    setShowingPapers(true);
    setFinished(true);
  }

  function acknowledge() {
    if (draft === null) return;
    setAcknowledging(true);
    for (const flag of firing) {
      outbox.add('/api/redflag/ack', { visitId: draft.visitId, ruleId: flag.ruleId, ruleVersion: flag.ruleVersion });
    }
    setDraft({ ...draft, acknowledged: [...draft.acknowledged, ...firing.map((f) => `${f.ruleId}@${f.ruleVersion}`)] });
    setAcknowledging(false);
  }

  // Being opened without the laptop IS being out of reach of it, and
  // the strip must not say "connected" on a screen that has just said
  // the tablet let somebody in because the laptop could not be asked.
  // offlineDesk clears the moment the real sign-in goes through, so
  // this stops saying it at exactly the right moment.
  /**
   * The number was called out and nobody stood up.
   *
   * Written down, never acted on: the patient keeps their status, their
   * place and their serial, and stays on the doctor's list exactly
   * where they were. All this does is record that it happened and let
   * the desk move to whoever has been called fewest times.
   *
   * Through the outbox like everything else, so a wifi drop between the
   * doctor finishing and the desk calling does not lose the record --
   * and so the same tap is never counted twice, because the deskRef
   * goes with it.
   */
  async function nobodyCame(who: { visitId: string; serialNo: number }): Promise<void> {
    const by = session?.signedIn?.id ?? offlineDesk?.who.id ?? null;
    if (by !== null) {
      outbox.add('/api/queue/no-answer', {
        deskRef: `na-${who.visitId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        visitId: who.visitId,
        calledBy: by,
        calledAt: new Date().toISOString(),
      });
    }
    // Off the screen at once. The desk has a room in front of it and
    // must not wait on the wifi to call the next number; the signal
    // brings the next patient up within a few seconds.
    setCalled(null);
    // ...and asked for immediately rather than at the next tick, so
    // there is no gap where the tablet shows nothing.
    try {
      await outbox.flush();
      const signal = await api.deskSignal();
      if (signal !== null && signal.inChamber === null && signal.nextWaiting !== null) {
        announced.current = signal.at;
        setCalled({ ...signal.nextWaiting, outOfTurn: false, nextUp: true });
      }
    } catch { /* the poll a few seconds from now will do it */ }
  }

  const offline = status.offlineSince !== null || offlineDesk !== null;

  return (
    <div className="screen">
      {/* Sits on top of whatever the assistant was doing, and takes
          nothing away from it: no draft is cleared, no answer is lost,
          and closing this comes straight back to the same half-typed
          screen. */}
      {called !== null && (
        <CalledIn
          serialNo={called.serialNo}
          nameBn={called.nameBn}
          nameEn={called.nameEn}
          outOfTurn={called.outOfTurn}
          nextUp={called.nextUp === true}
          noAnswer={called.noAnswer ?? 0}
          onlyOneWaiting={called.onlyOneWaiting === true}
          silent={!chimeIsArmed()}
          bn={bn}
          onSent={() => setCalled(null)}
          // Offered only while the desk is working down the list on its
          // own. A patient the DOCTOR asked for by number who does not
          // appear is news for him, not something for the desk to move
          // past on its own.
          onNoAnswer={called.nextUp === true ? () => { void nobodyCame(called); } : undefined}
        />
      )}

      {draft !== null && firing.length > 0 && (
        <Alarm messages={firing} acknowledging={acknowledging} onAcknowledge={acknowledge} />
      )}

      <div className="topbar">
        {draft === null ? (
          <div className="who">{session?.chamberName ?? '—'}<small>{session?.visitDate ?? ''}</small></div>
        ) : (
          <div className="who">{bn ? 'সিরিয়াল' : 'Serial'} {draft.serialNo} · {draft.name}
            <small>{bn ? 'তথ্য নেওয়া হচ্ছে' : 'taking the history'}</small></div>
        )}
        <span className="spacer" />
        <span className={`conn ${offline ? 'off' : 'ok'}`}>
          {offline
            ? `${bn ? 'ল্যাপটপ পাওয়া যাচ্ছে না' : 'laptop not reachable'}${status.pending > 0 ? ` · ${status.pending}` : ''}`
            : (bn ? 'যুক্ত আছে' : 'connected')}
        </span>
        <button className={`lang ${bn ? 'on' : ''}`} onClick={() => setBn(true)}>বাংলা</button>
        <button className={`lang ${bn ? '' : 'on'}`} onClick={() => setBn(false)}>English</button>
      </div>

      {offline && offlineDesk === null && (
        <div className="notice">
          <div className="t">{bn ? 'ল্যাপটপের সাথে সংযোগ নেই — কাজ চালিয়ে যান।' : 'No connection to the laptop — carry on.'}</div>
          <div className="d">
            {bn
              ? `যা লিখছেন সব ট্যাবলেটে জমা থাকছে${status.pending > 0 ? ` (${status.pending}টি)` : ''} এবং সংযোগ ফিরলে নিজেই চলে যাবে।`
              : `Everything is being kept on the tablet${status.pending > 0 ? ` (${status.pending} waiting)` : ''} and goes across on its own when the wifi returns.`}
          </div>
        </div>
      )}

      {/* Opened without the laptop. Said out loud, because the desk has
          to know that nothing they do this evening has reached the
          laptop yet -- and because "who is holding this tablet" is not
          settled until the laptop has checked the PIN itself. */}
      {offlineDesk !== null && (
        <div className="notice">
          <div className="t">
            {bn
              ? `ল্যাপটপ ছাড়া খোলা হয়েছে — ${offlineDesk.who.displayName}`
              : `Opened without the laptop — ${offlineDesk.who.displayName}`}
          </div>
          <div className="d">
            {bn
              ? `ল্যাপটপ চালু হলে আপনার নামে নিজে থেকেই সাইন ইন হয়ে যাবে এবং জমে থাকা সব চলে যাবে${status.pending > 0 ? ` (${status.pending}টি)` : ''}।`
              : `When the laptop is next reachable this tablet signs in under your name on its own, and everything waiting here${status.pending > 0 ? ` (${status.pending})` : ''} goes across.`}
          </div>
        </div>
      )}

      {loadError !== null && session === null && (
        <div className="notice bad">
          <div className="t">{bn ? 'ল্যাপটপ পাওয়া যাচ্ছে না।' : 'The laptop cannot be reached.'}</div>
          <div className="d">{loadError}</div>
        </div>
      )}

      {questionnaire === null ? (
        <div className="empty">{bn ? 'প্রশ্ন পাওয়া যায়নি।' : 'No questions could be loaded yet.'}</div>
      ) : arriving ? (
        <Arrive
          bn={bn}
          deskChamber={deskChamber}
          visitDate={session?.visitDate ?? new Date().toISOString().slice(0, 10)}
          takenBy={session?.signedIn?.id ?? offlineDesk?.who.id ?? null}
          onCancel={() => setArriving(false)}
          onDone={(serialNo, name) => {
            setArriving(false);
            setJustGiven({ serialNo, name });
            void refresh();
          }}
        />
      ) : justGiven !== null ? (
        // The number, as big as the screen allows, because it is about
        // to be said out loud across a waiting room.
        <div className="done">
          <div className="serial-given">{justGiven.serialNo}</div>
          <div className="bn">{bn ? 'এই নম্বরটি রোগীকে বলুন' : 'Tell the patient this number'}</div>
          <div className="en">{justGiven.name}</div>
          <button className="btn" onClick={() => setJustGiven(null)}>{bn ? 'ঠিক আছে' : 'Done'}</button>
        </div>
      ) : draft === null ? (
        <>
          <PickPatient queue={session?.queue ?? []} bn={bn} onPick={startWith} />
          <div className="arrive-actions">
            <button onClick={() => setArriving(true)}>{bn ? 'রোগী এসেছেন' : 'A patient has arrived'}</button>
          </div>
        </>
      ) : consentUnusable ? (
        <div className="consent-blocked">
          <div className="notice bad">
            <div className="t">{bn ? 'অনুমতির লেখা এখনো অনুমোদিত হয়নি।' : 'The consent wording has not been approved yet.'}</div>
            <div className="d">
              {bn
                ? 'অনুমতি ছাড়া কোনো প্রশ্ন করা যাবে না। ল্যাপটপের পর্দায় কী ঠিক করতে হবে লেখা আছে।'
                : 'No questions can be asked without permission first. The laptop screen says what needs fixing.'}
            </div>
            <ul>{(session?.consentBlocksLiveUse ?? []).map((b, i) => <li key={i}>{b.reason}</li>)}</ul>
          </div>
          <button className="btn" onClick={clearScreen}>{bn ? '← রোগীর তালিকা' : '← Patient list'}</button>
        </div>
      ) : draft.stage === 'declined' ? (
        <div className="done">
          <div className="bn">{bn ? consentConfig?.careRecord.declinedNote.bn : consentConfig?.careRecord.declinedNote.en}</div>
          <div className="en">{bn ? consentConfig?.careRecord.declinedNote.en : consentConfig?.careRecord.declinedNote.bn}</div>
          <button className="btn" onClick={clearScreen}>{bn ? 'পরের রোগী' : 'Next patient'}</button>
        </div>
      ) : draft.stage === 'consent_care' && consentConfig !== null ? (
        <Consent part={consentConfig.careRecord} bn={bn}
                 onDecide={(d, m, g) => decideConsent('care_record', d, m, g)} />
      ) : draft.stage === 'consent_research' && consentConfig !== null ? (
        <Consent part={consentConfig.research} bn={bn}
                 onDecide={(d, m, g) => decideConsent('research', d, m, g)} />
      ) : showingPapers && draft !== null ? (
        <Papers visitId={draft.visitId} bn={bn} onDone={() => setShowingPapers(false)} />
      ) : draft.reportsOnly && !finished ? (
        // Here to show a test the doctor asked for last time. There is
        // no new complaint to ask about, and asking anyway would fill
        // the record with "nothing" -- which reads exactly like a
        // screening nobody took. So: photograph the paper, and finish.
        <div className="done reports-only">
          <div className="bn">শুধু রিপোর্ট দেখাতে এসেছেন</div>
          <div className="en">Here to show a test report</div>
          <p className="lede">
            {bn
              ? 'নতুন সমস্যার প্রশ্ন করা হবে না। কাগজগুলো ছবি তুলে রাখুন, ডাক্তার পর্দাতেই দেখতে পাবেন।'
              : 'No questions about a new complaint. Photograph the papers and the doctor sees them on his screen.'}
          </p>
          <button className="btn" onClick={() => setShowingPapers(true)}>
            {bn ? 'কাগজের ছবি তুলুন' : 'Photograph the reports'}
          </button>
          <button className="btn quiet" onClick={finish}>
            {bn ? 'হয়ে গেছে' : 'Done'}
          </button>
        </div>
      ) : finished ? (
        <div className="done">
          <div className="tick">✓</div>
          <div className="bn">ধন্যবাদ। তথ্য নেওয়া হয়েছে।</div>
          <div className="en">Thank you. The history has been recorded.</div>
          <button className="btn" onClick={clearScreen}>{bn ? 'পরের রোগী' : 'Next patient'}</button>
        </div>
      ) : (
        (() => {
          const question = nextQuestion(questionnaire, facts, draft.presented);
          if (question === null) {
            return (
              <div className="done">
                <div className="bn">সব প্রশ্ন শেষ।</div>
                <div className="en">That is all the questions.</div>
                <button className="btn" onClick={finish}>{bn ? 'জমা দিন' : 'Save and finish'}</button>
              </div>
            );
          }
          return (
            <Ask
              question={question}
              existing={draft.answers[question.key]}
              index={draft.presented.length}
              total={expectedQuestionCount(questionnaire, facts)}
              bn={bn}
              onAnswer={(answer) => record(question.key, { ...answer, skipped: false })}
              onSkip={() => record(question.key, { value: null, freeText: null, skipped: true })}
              onFinish={finish}
              onBack={clearScreen}
            />
          );
        })()
      )}

    </div>
  );
}

export { Outbox };
