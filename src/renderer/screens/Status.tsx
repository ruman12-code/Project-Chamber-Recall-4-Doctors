import { useCallback, useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { RedFlagAlert } from './RedFlagAlert';
import { RecallCardScreen } from './RecallCard';
import { PatientSearch } from './PatientSearch';
import { Queue } from './Queue';
import { ROLES, roleLabel, type Role } from '../../shared/roles';
import type { DatabaseSummary, RedFlagStatus, RedFlagAlertView, TabletStatus } from '../../shared/ipc';
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
  const [tablet, setTablet] = useState<TabletStatus | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    void (async () => {
      const { value, failure } = unwrap(await api.laptopRole());
      if (failure) { setFailure(failure); return; }
      setRole(value!.role as Role);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const { value, failure } = unwrap(await api.summary());
      if (failure) { setFailure(failure); return; }
      setSummary(value!.summary);
    })();
  }, []);

  useEffect(() => {
    // The pairing code changes when a tablet is paired, so this is
    // re-read rather than fetched once.
    const read = async () => {
      const { value, failure } = unwrap(await api.tabletStatus());
      if (!failure) setTablet(value!.status);
    };
    void read();
    const timer = setInterval(() => { void read(); }, 5000);
    return () => clearInterval(timer);
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

  async function openCardForVisit(visitId: string) {
    const { value, failure } = unwrap(await api.recallCardFor(visitId));
    if (failure) { setFailure(failure); return; }
    if (value!.card === null) {
      setFailure({
        userMessage: 'That patient’s card could not be built.',
        whatToDo: 'Nothing has been changed. Go back to today’s list and try again; if it happens twice, report it before carrying on.',
        technical: `recall:card returned null for visit ${visitId}`,
      });
      return;
    }
    setCard(value!.card);
  }

  /**
   * Re-reads the open card from the database. Called after the doctor
   * confirms or corrects anything, and on a timer while the card is
   * open, so a red flag raised at the front desk while the patient is
   * already in the chamber appears on the card without anybody
   * reopening it.
   */
  const reloadCard = useCallback(async () => {
    if (card === null) return;
    const { value, failure } = unwrap(await api.recallCardFor(card.today.visitId));
    if (failure) { setFailure(failure); return; }
    if (value!.card !== null) setCard(value!.card);
  }, [card]);

  useEffect(() => {
    if (card === null) return;
    const timer = setInterval(() => { void reloadCard(); }, 15000);
    return () => clearInterval(timer);
  }, [card, reloadCard]);

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

  // The card is not shown until the laptop role has been read. Which
  // chair the laptop is speaking for decides whether Confirm works, so
  // guessing it - even guessing "doctor", which is right nearly every
  // time - would put a button on screen that lies about what it does.
  if (card !== null && role !== null) {
    return <RecallCardScreen card={card} role={role} onReload={reloadCard} onClose={() => setCard(null)} />;
  }
  if (findingPatient) return <PatientSearch onClose={() => setFindingPatient(false)} />;
  if (showingQueue) {
    return <Queue onClose={() => setShowingQueue(false)} onOpenCard={(visitId) => { void openCardForVisit(visitId); }} />;
  }

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
        <h2 style={{ marginTop: 0 }}>Who is at this laptop</h2>
        <p>
          This is not a login. Nothing is proved and there is no password: it is a setting that
          says which chair the laptop is speaking for, so that everything written from here is
          recorded against somebody rather than against nobody. Signing in properly comes later.
        </p>
        <p>
          It matters for one thing today: only the doctor can confirm a history the front desk
          took, because confirming it makes it part of the patient’s medical record.
        </p>
        {role === null ? <p className="muted">Reading…</p> : (
          <select
            value={role}
            aria-label="Who is at this laptop"
            onChange={(e) => {
              const chosen = e.target.value as Role;
              void (async () => {
                const { failure } = unwrap(await api.setLaptopRole(chosen));
                if (failure) { setFailure(failure); return; }
                setRole(chosen);
              })();
            }}
          >
            {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r).en} · {roleLabel(r).bn}</option>)}
          </select>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>The Recall Card</h2>
        <p>
          The patient who is with the doctor right now in today’s session. Confirm and Correct
          are live: confirming takes the front desk’s history into the record under your name,
          and correcting adds your wording beside theirs without ever replacing it. To open any
          other patient’s card, use today’s list.
        </p>
        <button onClick={openRecallCard}>Open the Recall Card</button>
      </div>

      {tablet !== null && <TabletSection status={tablet} onRevoke={async (id) => {
        unwrap(await api.tabletRevoke(id));
        const { value } = unwrap(await api.tabletStatus());
        if (value) setTablet(value.status);
      }} />}

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

function TabletSection({ status, onRevoke }: { status: TabletStatus; onRevoke: (id: string) => void }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>The front desk tablet</h2>

      {!status.running ? (
        <div className="failure" role="alert">
          <div className="what">The tablet cannot connect to this laptop.</div>
          <div className="do">
            {status.problem ?? 'The local network server is not running.'} The register and the
            Recall Card still work; only the tablet is affected.
          </div>
        </div>
      ) : (
        <>
          <p>
            On the tablet, open a browser and go to one of these addresses. There is no internet
            involved: this is the chamber's own network, and it works with the router unplugged
            from the outside line.
          </p>
          <p>
            {status.addresses.length === 0
              ? <span className="muted">This laptop is not on any network yet, so the tablet has nothing to connect to. Join the chamber's wifi.</span>
              : status.addresses.map((address) => (
                <span className="recovery-key" key={address} style={{ fontSize: 22, padding: 12, margin: '6px 0' }}>
                  http://{address}:{status.port}
                </span>
              ))}
          </p>

          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)' }}>
            Pairing code
          </h3>
          {status.pairingLocked ? (
            <div className="failure" role="alert">
              <div className="what">Too many wrong codes have been tried.</div>
              <div className="do">Close this program and open it again before pairing a tablet.</div>
            </div>
          ) : (
            <>
              <div className="recovery-key">{status.pairingCode}</div>
              <p className="muted">
                Type this into the tablet once. It changes every time this program starts, and
                again after each tablet is paired. Only a tablet that has been given a code can
                see the waiting list or the questions.
              </p>
            </>
          )}

          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--muted)' }}>
            Tablets connected
          </h3>
          {status.devices.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <table>
              <thead><tr><th>Tablet</th><th>Paired</th><th>Last seen</th><th /></tr></thead>
              <tbody>
                {status.devices.map((device) => (
                  <tr key={device.id}>
                    <td>{device.label}</td>
                    <td className="muted">{new Date(device.pairedAt).toLocaleString()}</td>
                    <td className="muted">{device.lastSeenAt === null ? 'never' : new Date(device.lastSeenAt).toLocaleString()}</td>
                    <td><button className="secondary" style={{ margin: 0, padding: '6px 12px', fontSize: 13 }}
                                onClick={() => onRevoke(device.id)}>Disconnect</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
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
