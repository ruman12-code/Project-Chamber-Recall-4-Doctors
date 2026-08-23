import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, outbox, storedToken, NeedsPairingError } from './api';
import { Outbox, type OutboxStatus } from './outbox';
import { Pair } from './screens/Pair';
import { PickPatient } from './screens/PickPatient';
import { Ask } from './screens/Ask';
import { Alarm } from './screens/Alarm';
import { nextQuestion, expectedQuestionCount, type Questionnaire } from '../main/intake/flow';
import { evaluateRulebook } from '../main/redflags/evaluate';
import type { Rulebook } from '../main/redflags/types';
import type { Facts } from '../main/rules/facts';
import type { QueueEntry } from '../shared/queue';

/** Fifteen minutes with nobody touching it and the screen goes back. */
const IDLE_CLEAR_MS = 15 * 60 * 1000;
const SESSION_KEY = 'chamber-recall.session.v1';
const DRAFT_KEY = 'chamber-recall.draft.v1';
const LANG_KEY = 'chamber-recall.lang.v1';

interface Answer { value: string | null; freeText: string | null; skipped: boolean }

interface Draft {
  visitId: string;
  serialNo: number;
  name: string;
  patient: { ageYears: number | null; sex: string | null };
  answers: Record<string, Answer>;
  presented: string[];
  acknowledged: string[];
  touchedAt: number;
}

interface CachedSession {
  questionnaire: Questionnaire | null;
  rulebook: Rulebook | null;
  queue: QueueEntry[];
  chamberName: string | null;
  visitDate: string;
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
  const [session, setSession] = useState<CachedSession | null>(() => readJson<CachedSession>(SESSION_KEY));
  const [draft, setDraft] = useState<Draft | null>(() => readJson<Draft>(DRAFT_KEY));
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
        queue: QueueEntry[]; chamber: { name: string | null }; visitDate: string;
      };
      const next: CachedSession = {
        questionnaire: raw.questionnaire, rulebook: raw.rulebook, queue: raw.queue,
        chamberName: raw.chamber.name, visitDate: raw.visitDate, cachedAt: new Date().toISOString(),
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

  const questionnaire = session?.questionnaire ?? null;

  function startWith(entry: QueueEntry) {
    outbox.add('/api/intake/start', { visitId: entry.visitId });
    setDraft({
      visitId: entry.visitId,
      serialNo: entry.serialNo,
      name: entry.nameBn ?? entry.nameEn ?? '',
      patient: { ageYears: entry.ageYears, sex: entry.sex },
      answers: {}, presented: [], acknowledged: [], touchedAt: Date.now(),
    });
    setFinished(false);
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
