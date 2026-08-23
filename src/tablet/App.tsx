import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, outbox, storedToken, NeedsPairingError } from './api';
import { Outbox, type OutboxStatus } from './outbox';
import { Pair } from './screens/Pair';
import { DeskSignIn, type DeskPerson } from './screens/DeskSignIn';
import { PickPatient, type QueueEntryWithConsent } from './screens/PickPatient';
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
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { outbox.start(); return outbox.onChange(setStatus); }, []);
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
      const raw = await api.session() as unknown as {
        questionnaire: Questionnaire | null; rulebook: Rulebook | null;
        queue: QueueEntryWithConsent[]; chamber: { name: string | null }; visitDate: string;
        dataMode: 'demo' | 'live'; consent: ConsentConfig | null;
        consentBlocksLiveUse: Array<{ reason: string; whatToDo: string }>;
        people?: DeskPerson[]; signedIn?: DeskPerson | null; signInRequired?: boolean;
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
    } catch (caught) {
      if (caught instanceof NeedsPairingError) { setPaired(false); return; }
      // Not being able to reach the laptop is not an error worth
      // stopping for when there is a copy already on the tablet.
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    if (!paired) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 20000);
    return () => clearInterval(timer);
  }, [paired, refresh]);

  // ---- kiosk-ish: fill the screen, and do not offer a way out of it
  useEffect(() => {
    const goFullscreen = () => {
      if (document.fullscreenElement === null) void document.documentElement.requestFullscreen?.().catch(() => undefined);
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
  if (session !== null && session.signInRequired && session.signedIn === null) {
    return <DeskSignIn people={session.people} bn={bn} onSignedIn={() => { void refresh(); }} />;
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

  const offline = status.offlineSince !== null;

  return (
    <div className="screen">
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

      {offline && (
        <div className="notice">
          <div className="t">{bn ? 'ল্যাপটপের সাথে সংযোগ নেই — কাজ চালিয়ে যান।' : 'No connection to the laptop — carry on.'}</div>
          <div className="d">
            {bn
              ? `যা লিখছেন সব ট্যাবলেটে জমা থাকছে${status.pending > 0 ? ` (${status.pending}টি)` : ''} এবং সংযোগ ফিরলে নিজেই চলে যাবে।`
              : `Everything is being kept on the tablet${status.pending > 0 ? ` (${status.pending} waiting)` : ''} and goes across on its own when the wifi returns.`}
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
      ) : draft === null ? (
        <PickPatient queue={session?.queue ?? []} bn={bn} onPick={startWith} />
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
