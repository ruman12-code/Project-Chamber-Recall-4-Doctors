import { useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { RedFlagAlert } from './RedFlagAlert';
import { RecallCardScreen } from './RecallCard';
import { PatientSearch } from './PatientSearch';
import { Queue } from './Queue';
import type { DatabaseSummary, RedFlagStatus, RedFlagAlertView } from '../../shared/ipc';
import type { RecallCard } from '../../shared/recall';

const LABELS: Record<string, string> = {
  patient: 'Patients',
  chamber: 'Chambers',
  visit: 'Visits',
  intake: 'Intakes taken',
  intake_answer: 'Intake answers',
  red_flag_event: 'Red flag events',
  vitals: 'Vitals recorded',
  encounter: 'Encounters',
  medication: 'Medication lines',
  investigation: 'Investigations',
  investigations_outstanding: 'Investigations with no result yet',
  red_flag_evaluation: 'Rule evaluations recorded',
  attachment: 'Attachments',
  app_user: 'Users',
  audit_log: 'Audit entries',
  usage_event: 'Usage events',
};

/**
 * Milestone 1 only. This screen exists to prove the foundations are
 * real: the database opened, the schema is there, the seeded history
 * is the right size, and the audit log is recording. It is scaffolding
 * for the build, not a screen anyone will use in a chamber.
 */
export function Status() {
  const [summary, setSummary] = useState<DatabaseSummary | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [previewing, setPreviewing] = useState<RedFlagAlertView | null>(null);
  const [card, setCard] = useState<RecallCard | null>(null);
  const [findingPatient, setFindingPatient] = useState(false);
  const [showingQueue, setShowingQueue] = useState(false);

  useEffect(() => {
    void (async () => {
      const { value, failure } = unwrap(await api.summary());
      if (failure) { setFailure(failure); return; }
      setSummary(value!.summary);
    })();
  }, []);

  async function openRecallCard() {
    const { value, failure } = unwrap(await api.recallCard());
    if (failure) { setFailure(failure); return; }
    if (value!.card === null) {
      setFailure({
        userMessage: 'There is nobody in the queue today to show a card for.',
        whatToDo: 'Rebuild the practice database with "npm run seed", which creates a session for today.',
        technical: 'recall:card returned null',
      });
      return;
    }
    setCard(value!.card);
  }

  async function showRealAlert() {
    const { value, failure } = unwrap(await api.redFlagSample());
    if (failure) { setFailure(failure); return; }
    if (value!.alert === null) {
      setFailure({
        userMessage: 'There is no unacknowledged alert in this database to show.',
        whatToDo: 'Rebuild the practice database with "npm run seed" to get fresh ones.',
        technical: 'redflags:sample returned null',
      });
      return;
    }
    setPreviewing(value!.alert);
  }

  if (failure) return <div className="page"><FailureNotice failure={failure} /></div>;
  if (summary === null) return <div className="page"><p className="muted">Reading the records…</p></div>;

  if (previewing !== null) {
    return <RedFlagAlert alert={previewing} onAcknowledged={() => setPreviewing(null)} />;
  }

  if (card !== null) return <RecallCardScreen card={card} onClose={() => setCard(null)} />;
  if (findingPatient) return <PatientSearch onClose={() => setFindingPatient(false)} />;
  if (showingQueue) return <Queue onClose={() => setShowingQueue(false)} />;

  return (
    <div className="page">
      {summary.dataMode === 'demo' && (
        <div className="banner">
          PRACTICE DATABASE — the people in here are invented. Never enter a real patient.
        </div>
      )}

      <h1>Foundations</h1>
      <p className="subtitle">
        Milestone 1: encrypted database, full schema, roles, append-only audit log, and seeded history.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>The Recall Card</h2>
        <p>
          Milestone 3, shown against the practice database: the patient who is with the doctor
          right now in today's session. Nothing on it is wired yet.
        </p>
        <button onClick={openRecallCard}>Open the Recall Card</button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Today's list</h2>
        <p>
          Milestone 5: the serial register and the live queue. Give arriving patients their
          number, see who is waiting and for how long, and change who is seen next.
        </p>
        <button onClick={() => setShowingQueue(true)}>Open today's list</button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Patients</h2>
        <p>
          Milestone 4: search by phone or name, register someone new, and put duplicate records
          together. The practice database contains deliberate duplicates to try it on.
        </p>
        <button onClick={() => setFindingPatient(true)}>Find a patient</button>
      </div>

      <h2>What is in the database</h2>
      <div className="grid">
        {Object.entries(summary.counts).map(([key, n]) => (
          <div className="stat" key={key}>
            <div className="n">{n.toLocaleString()}</div>
            <div className="k">{LABELS[key] ?? key}</div>
          </div>
        ))}
      </div>

      <RedFlagSection status={summary.redFlags} onShowAlert={showRealAlert} />

      <h2>Most recent audit entries</h2>
      <p className="muted">
        This log can be added to and never changed or removed. The database itself refuses
        an edit or a delete, so no part of this program can quietly rewrite its own history.
      </p>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>What happened</th><th>To what</th></tr>
          </thead>
          <tbody>
            {summary.recentAudit.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{new Date(entry.timestamp).toLocaleString()}</td>
                <td>{entry.actor_role}</td>
                <td>{entry.action}</td>
                <td className="muted">{entry.entity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted">
        Created {summary.createdAt ? new Date(summary.createdAt).toLocaleString() : 'unknown'}
        {summary.seededAt && ` · practice data added ${new Date(summary.seededAt).toLocaleString()}`}
      </p>
    </div>
  );
}

function RedFlagSection({ status, onShowAlert }: { status: RedFlagStatus; onShowAlert: () => void }) {
  const usable = status.blocksLiveUse.length === 0;

  return (
    <>
      <h2>Red flag rules</h2>
      <div className="card">
        <p>
          <span className={usable ? 'pill ok' : 'pill bad'}>
            {usable ? 'approved for real patients' : 'not usable for real patients'}
          </span>
          <span className="pill">{status.ruleCount} rules</span>
          {status.placeholderCount > 0 && <span className="pill bad">{status.placeholderCount} placeholder</span>}
          {status.checksum !== null && <span className="pill">file {status.checksum}</span>}
        </p>

        {!usable && (
          <>
            <p>
              This is a practice database, so it runs anyway. A real one would not open at all
              until every point below was fixed.
            </p>
            <ol>
              {status.blocksLiveUse.map((block, i) => (
                <li key={i}><span className="r">{block.reason}</span> {block.whatToDo}</li>
              ))}
            </ol>
          </>
        )}

        {status.problems.length > 0 && (
          <ol>
            {status.problems.map((problem, i) => (
              <li key={i}>
                <div className="problem-line">
                  {problem.line === null ? problem.where : `line ${problem.line} · ${problem.where}`}
                </div>
                <div className="r">{problem.problem}</div>
                <div>{problem.whatToDo}</div>
              </li>
            ))}
          </ol>
        )}

        <p className="muted">
          The rules are in <span className="problem-line">{status.path}</span>. Edit that file in any
          text editor; it is never overwritten by reinstalling the software.
        </p>

        <button className="secondary" onClick={onShowAlert}>
          Show a real alert as the assistant sees it
        </button>
        <p className="muted">
          This takes a genuine alert out of this database, produced by running these rules over
          a patient's answers. Acknowledging it records the acknowledgement for real.
        </p>
      </div>
    </>
  );
}
