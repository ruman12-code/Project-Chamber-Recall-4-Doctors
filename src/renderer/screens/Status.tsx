import { useCallback, useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { RedFlagAlert } from './RedFlagAlert';
import { RecallCardScreen } from './RecallCard';
import { PatientSearch } from './PatientSearch';
import { Queue } from './Queue';
import { ChamberScreen } from './Chamber';
import { SignIn, SetUpPeople } from './SignIn';
import { PrescriptionSheet } from './PrescriptionSheet';
import { Attachments } from './Attachments';
import { PatientCopySheet } from './PatientCopySheet';
import { PilotReportScreen } from './PilotReportScreen';
import { WhichChamber } from './WhichChamber';
import { roleLabel, type Role } from '../../shared/roles';
import { HOME_PANELS, panelsForRole, type HomePanelId } from '../../shared/home';
import type { DatabaseSummary, RedFlagStatus, RedFlagAlertView, TabletStatus } from '../../shared/ipc';
import type { RecallCard } from '../../shared/recall';
import type { AuthState } from '../../shared/ipc';
import type { ChamberView } from '../../shared/clinical';
import type { BackupStatus } from '../../shared/backup';

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
 * The screen the program opens on: what is in the records, how to
 * reach each part of the chamber's evening, and - the one thing on
 * here that is nobody's job unless the screen makes it somebody's -
 * when this was last backed up.
 */
export function Status() {
  const [summary, setSummary] = useState<DatabaseSummary | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [panels, setPanels] = useState<string[] | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [showingMore, setShowingMore] = useState(false);
  /** Where the records are kept on this laptop. Asked for once. */
  const [dataDir, setDataDir] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const { value } = unwrap(await api.status());
      setDataDir(value?.status.dataDir ?? null);
    })();
  }, []);
  /**
   * Which chamber the doctor said he is in, this session. Null means
   * the question has not been answered yet and the chamber cards are
   * the screen. Not remembered across sign-ins: he may well be in the
   * other one tomorrow, and a laptop that assumes otherwise would put
   * a patient on the wrong list.
   */
  const [inChamber, setInChamber] = useState<{ id: string; name: string } | null>(null);
  const [previewing, setPreviewing] = useState<RedFlagAlertView | null>(null);
  const [card, setCard] = useState<RecallCard | null>(null);
  const [findingPatient, setFindingPatient] = useState(false);
  const [showingQueue, setShowingQueue] = useState(false);
  const [tablet, setTablet] = useState<TabletStatus | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [showingPeople, setShowingPeople] = useState(false);
  const [chamber, setChamber] = useState<ChamberView | null>(null);
  const [printingVisitId, setPrintingVisitId] = useState<string | null>(null);
  const [papersFor, setPapersFor] = useState<
    { patientId: string; visitId: string | null; name: string } | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [copyFor, setCopyFor] = useState<string | null>(null);
  const [findingForCopy, setFindingForCopy] = useState(false);
  const [showingReport, setShowingReport] = useState(false);

  const readBackup = useCallback(async () => {
    const { value, failure } = unwrap(await api.backupStatus());
    if (failure) { setFailure(failure); return; }
    setBackup(value!.status);
  }, []);
  useEffect(() => { void readBackup(); }, [readBackup]);

  const readAuth = useCallback(async () => {
    const { value, failure } = unwrap(await api.whoIsSignedIn());
    if (failure) { setFailure(failure); return; }
    setAuth(value!.auth);
  }, []);
  useEffect(() => { void readAuth(); }, [readAuth]);

  const readPanels = useCallback(async () => {
    const { value, failure } = unwrap(await api.homePanels());
    if (failure) { setFailure(failure); return; }
    setPanels(value!.panels);
  }, []);
  useEffect(() => { void readPanels(); }, [readPanels]);

  const role: Role | null = auth?.signedIn === null || auth === null ? null : (auth.signedIn.role as Role);
  /** Is this panel pinned to the front page, and allowed for this role? */
  const pinned = (id: HomePanelId): boolean =>
    panels !== null && panels.includes(id) && role !== null
    && panelsForRole(role).some((p) => p.id === id);

  /**
   * What is in the database.
   *
   * Re-read whenever who is signed in changes, NOT once on mount. This
   * screen renders the set-up screens from inside itself, so it is
   * already mounted while the practice database is being filled -- and
   * a summary read once showed the counts from before the fill for the
   * rest of the session. Three users, no patients, on a database with
   * three hundred of them.
   */
  const readSummary = useCallback(async () => {
    const { value, failure } = unwrap(await api.summary());
    if (failure) { setFailure(failure); return; }
    setSummary(value!.summary);
  }, []);
  useEffect(() => { void readSummary(); }, [readSummary, auth]);

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
   * The chamber screen knows the visit but not the patient id, and
   * the papers belong to the patient rather than to one evening. So
   * it is looked up rather than guessed at.
   */
  async function openPapersForVisit(visitId: string, name: string) {
    const { value, failure } = unwrap(await api.recallCardFor(visitId));
    if (failure) { setFailure(failure); return; }
    if (value!.card === null) return;
    setPapersFor({ patientId: value!.card.patient.id, visitId, name });
  }

  async function openChamber(visitId: string) {
    const { value, failure } = unwrap(await api.chamberOpen(visitId));
    if (failure) { setFailure(failure); return; }
    setCard(null);
    setChamber(value!.view);
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

  // A failure must never be a dead end. Before this there was no way
  // off this screen at all, and the front desk pressing a button meant
  // for the doctor left them looking at a red box with nowhere to go.
  if (failure) {
    return (
      <div className="page">
        <FailureNotice failure={failure} />
        <button onClick={() => setFailure(null)}>Go back</button>
      </div>
    );
  }
  if (summary === null) return <div className="page"><p className="muted">Reading the records…</p></div>;

  if (previewing !== null) {
    return <RedFlagAlert alert={previewing} onAcknowledged={() => setPreviewing(null)} />;
  }

  // Nothing at all is shown until the program knows who is using it.
  // A screen that works before anybody has signed in is a screen that
  // writes a record with nobody's name on it.
  if (auth === null) return <div className="page"><p className="muted">Reading…</p></div>;
  if (auth.needsSetup || showingPeople) {
    return <SetUpPeople demo={summary.dataMode === 'demo'} onDone={async () => {
      setShowingPeople(false); await readSummary(); await readAuth();
    }} />;
  }
  if (auth.signedIn === null) {
    return <SignIn demo={summary.dataMode === 'demo'} onSignedIn={readAuth} />;
  }

  if (showingReport) {
    return <PilotReportScreen onClose={() => setShowingReport(false)} />;
  }
  if (copyFor !== null) {
    return <PatientCopySheet patientId={copyFor} onClose={() => setCopyFor(null)} />;
  }
  if (findingForCopy) {
    return <PatientSearch
      onClose={() => setFindingForCopy(false)}
      pickLabel="Give them their copy"
      onPick={(patient) => { setFindingForCopy(false); setCopyFor(patient.id); }} />;
  }

  // The papers and the prescription both sit above whatever is open
  // underneath, because both are something being looked at rather than
  // a screen being worked in. Closing comes back to what was there.
  if (papersFor !== null) {
    return <Attachments
      patientId={papersFor.patientId}
      visitId={papersFor.visitId}
      patientName={papersFor.name}
      onClose={() => { setPapersFor(null); void reloadCard(); }} />;
  }

  // The prescription sits above everything, because it is a piece of
  // paper being looked at rather than a screen being worked in.
  if (printingVisitId !== null) {
    return <PrescriptionSheet visitId={printingVisitId} onClose={() => setPrintingVisitId(null)} />;
  }

  // The card is checked BEFORE the consultation, so that opening
  // somebody's history from the chamber puts it ON TOP of what is
  // being typed and closing it comes straight back to it. With these
  // the other way round - which is how this was first written - the
  // "Their history" button silently did nothing at all.
  if (card !== null && role !== null) {
    return <RecallCardScreen
      card={card}
      role={role}
      onReload={reloadCard}
      onClose={() => setCard(null)}
      onRecord={() => { void openChamber(card.today.visitId); }}
      onPapers={() => setPapersFor({
        patientId: card.patient.id,
        visitId: card.today.visitId,
        name: card.patient.nameBn ?? card.patient.nameEn ?? 'unnamed',
      })} />;
  }

  if (chamber !== null && role !== null) {
    return <ChamberScreen
      view={chamber}
      role={role}
      onClose={() => setChamber(null)}
      onOpenCard={() => { void openCardForVisit(chamber.visitId); }}
      onPrint={() => setPrintingVisitId(chamber.visitId)}
      onPapers={() => { void openPapersForVisit(chamber.visitId, chamber.patientName); }}
      onReload={async () => {
        const { value, failure } = unwrap(await api.chamberView(chamber.visitId));
        if (failure) { setFailure(failure); return; }
        setChamber(value!.view);
      }}
    />;
  }

  // Which room am I in? Answered before anything else, because whose
  // list he sees and which front desk he is connected to both follow
  // from it. Front desk staff at the laptop answer it too: the register
  // belongs to a chamber just as much as the consultation does.
  if (inChamber === null) {
    return <WhichChamber
      signedInName={auth.signedIn.displayName}
      canEdit={role === 'doctor' || role === 'clinical_assistant'}
      onPick={(id, name) => setInChamber({ id, name })} />;
  }

  if (findingPatient) return <PatientSearch onClose={() => setFindingPatient(false)} />;
  if (showingQueue) {
    return <Queue
      onClose={() => setShowingQueue(false)}
      onChangeChamber={() => {
        setInChamber(null); setCard(null); setChamber(null); setShowingQueue(false);
      }}
      onOpenCard={role === null || role === 'front_desk' ? undefined : (visitId) => { void openCardForVisit(visitId); }}
      onRecord={role === null || role === 'front_desk' ? undefined : (visitId) => { void openChamber(visitId); }} />;
  }

  return (
    <div className="page">
      {summary.dataMode === 'demo' && (
        <div className="banner">
          PRACTICE DATABASE — the people in here are invented. Never enter a real patient.
        </div>
      )}

      {/* The home screen opens on the evening rather than on a menu.
          Today's list is below, live, with every action on it; what
          used to be here was a page of cards with the list itself
          below the fold. */}
      <div className="home-top">
        <div className="home-who">
          <b>{inChamber.name}</b>
          <span className="muted"> — </span>
          <b>{auth.signedIn.displayName}</b>
          <span className="muted"> — {roleLabel(role ?? 'front_desk').en} · {roleLabel(role ?? 'front_desk').bn}.
            Everything written from here carries this name.</span>
        </div>
        <div className="home-top-acts">
          <button className="secondary" onClick={() => {
            void (async () => {
              const { failure } = unwrap(await api.signOut());
              if (failure) { setFailure(failure); return; }
              setCard(null); setChamber(null); setShowingQueue(false); setFindingPatient(false);
              setInChamber(null);
              await readAuth();
            })();
          }}>Sign out</button>
          <button className="secondary" onClick={() => {
            setInChamber(null); setCard(null); setChamber(null);
            setShowingQueue(false); setFindingPatient(false);
          }}>Change chamber</button>
          <button className="secondary" onClick={() => setShowingMore((v) => !v)}>
            {showingMore ? 'Hide' : 'Everything else'}
          </button>
          {role === 'doctor' && (
            <button className="secondary" onClick={() => setChoosing(true)}>Choose what is here</button>
          )}
        </div>
      </div>

      {/* Somebody with a spare key set this person's PIN. They are told
          here, and keep being told, until they say they knew about it -
          because a reset that can happen quietly is a reset somebody can
          use to sign in as the doctor. */}
      {auth.pinReset != null && (
        <div className="card pin-reset-notice">
          <h2 style={{ marginTop: 0 }}>Your PIN was reset</h2>
          <p>
            On <b>{auth.pinReset.at.slice(0, 16).replace('T', ' at ')}</b>, somebody set a new PIN
            for you using the <b>{auth.pinReset.using}</b>.
          </p>
          <p>
            If that was you, or somebody you asked, there is nothing to do. <b>If it was not</b>,
            say so now: whoever did it could have signed in under your name, and anything written
            since then carries your name on it.
          </p>
          <button onClick={() => {
            void (async () => {
              const { failure } = unwrap(await api.pinResetAcknowledge());
              if (failure) { setFailure(failure); return; }
              await readAuth();
            })();
          }}>I knew about this</button>
        </div>
      )}

      {choosing && role === 'doctor' && (
        <div className="card choosing">
          <h2 style={{ marginTop: 0 }}>What is on this screen</h2>
          <p>
            Today's list is always here — it is what this screen is for. Everything else is your
            choice. <b>Turning something off never puts it out of reach</b>: it moves under
            "Everything else" at the top.
          </p>
          {HOME_PANELS.map((panel) => {
            const allowed = (panel.roles as readonly string[]).includes('doctor');
            if (!allowed) return null;
            const on = panels?.includes(panel.id) ?? false;
            return (
              <div className="checkline" key={panel.id}>
                <input id={`pnl-${panel.id}`} type="checkbox" checked={on} onChange={() => {
                  void (async () => {
                    const next = on
                      ? (panels ?? []).filter((p) => p !== panel.id)
                      : [...(panels ?? []), panel.id];
                    const { value, failure } = unwrap(await api.homePanelsSet(next));
                    if (failure) { setFailure(failure); return; }
                    setPanels(value!.panels);
                  })();
                }} />
                <label htmlFor={`pnl-${panel.id}`}>
                  <b>{panel.label}</b> — <span className="muted">{panel.what}</span>
                </label>
              </div>
            );
          })}
          <button onClick={() => setChoosing(false)}>Done</button>
        </div>
      )}

      {/* The evening itself. Not behind a button: who is waiting, who is
          with the doctor, who has been seen, and every action on each
          of them. The front desk gets the same list without the two
          clinical buttons, which is decided in the data layer as well
          as here. */}
      <Queue
        embedded
        onSessionOver={() => {
          setInChamber(null); setCard(null); setChamber(null);
        }}
        onOpenCard={role === null || role === 'front_desk' ? undefined : (visitId) => { void openCardForVisit(visitId); }}
        onRecord={role === null || role === 'front_desk' ? undefined : (visitId) => { void openChamber(visitId); }} />

      {(pinned('recall_card') || showingMore) && role !== 'front_desk' && <div className="card">
        <h2 style={{ marginTop: 0 }}>The Recall Card</h2>
        <p>
          The patient who is with the doctor right now in today’s session. Confirm and Correct
          are live: confirming takes the front desk’s history into the record under your name,
          and correcting adds your wording beside theirs without ever replacing it. To open any
          other patient’s card, use today’s list.
        </p>
        <button onClick={openRecallCard}>Open the Recall Card</button>
      </div>}

      {tablet !== null && (pinned('tablet') || showingMore) && <TabletSection
        status={tablet}
        onRevoke={async (id) => {
          unwrap(await api.tabletRevoke(id));
          const { value } = unwrap(await api.tabletStatus());
          if (value) setTablet(value.status);
        }}
        onSetChamber={async (deviceId, chamberId) => {
          const { failure } = unwrap(await api.tabletSetChamber(deviceId, chamberId));
          if (failure) { setFailure(failure); return; }
          const { value } = unwrap(await api.tabletStatus());
          if (value) setTablet(value.status);
        }}
        onPairingChamber={async (chamberId) => {
          unwrap(await api.tabletPairingChamber(chamberId));
          const { value } = unwrap(await api.tabletStatus());
          if (value) setTablet(value.status);
        }} />}

      {(pinned('backup') || pinned('patient_copy') || showingMore) && <BackupCard
        status={backup}
        note={backupNote}
        canGiveCopies={role !== 'front_desk' && (pinned('patient_copy') || showingMore)}
        onBackup={() => {
          void (async () => {
            setBackupNote('Copying and checking…');
            const { value, failure } = unwrap(await api.backupNow());
            if (failure) { setBackupNote(null); setFailure(failure); return; }
            if (value!.result === null) { setBackupNote(null); return; }
            setBackupNote(`Backed up and checked: ${value!.result.folder}`);
            await readBackup();
          })();
        }}
        onCheck={() => {
          void (async () => {
            const { value, failure } = unwrap(await api.backupInspect());
            if (failure) { setFailure(failure); return; }
            const inspection = value!.inspection;
            if (inspection === null) return;
            setBackupNote(inspection.problems.length === 0
              ? `That backup is sound: taken ${inspection.manifest?.takenAt.slice(0, 16).replace('T', ' ')}, `
                + `${inspection.manifest?.counts.patient ?? 0} patients, records file unchanged since.`
              : `That backup has problems — ${inspection.problems.join(' ')}`);
          })();
        }}
        onGiveCopy={() => setFindingForCopy(true)}
      />}

      {(pinned('pilot_report') || showingMore) && role !== 'front_desk' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>The pilot report</h2>
          <p>
            What has actually happened since this started: who was seen, what the questions caught,
            what was written down, and what did not work. It counts and it does not conclude —
            whether this is worth carrying on with is a judgement about patients and about a
            chamber, and the last part of the page is the questions it cannot answer.
          </p>
          <button onClick={() => setShowingReport(true)}>Open the pilot report</button>
        </div>
      )}


      {(pinned('find_patient') || showingMore) && <div className="card">
        <h2 style={{ marginTop: 0 }}>Patients</h2>
        <p>
          Search by phone or name, register someone new, and put duplicate records together.
          The practice database contains deliberate duplicates to try the merge tool on.
        </p>
        <button onClick={() => setFindingPatient(true)}>Find a patient</button>
      </div>}

      {/* The folder the records live in.
          The program has always known this and never said it, so the
          only way to find it was to be told -- and on Windows it sits
          inside AppData, which Explorer hides. It is needed for a
          backup, for moving to a replacement laptop, and for starting
          the practice data over. */}
      {showingMore && dataDir !== null && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Where the records are kept</h2>
          <p>
            Everything this program stores is in this one folder — the records, the key
            file, and the photographs. Copying this folder copies the whole installation.
          </p>
          <p className="datadir"><code>{dataDir}</code></p>
          <button onClick={() => { void api.openDataFolder(); }}>Open this folder</button>
          <p className="muted" style={{ marginBottom: 0 }}>
            Close this program before copying, moving or deleting anything in there.
          </p>
        </div>
      )}

      {(pinned('who_works_here') || showingMore) && role === 'doctor' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Who works here</h2>
          <p>
            Add somebody, change a PIN, or retire somebody who has left. Retiring stops them
            signing in and leaves every record they wrote exactly as it was, with their name
            still on it.
          </p>
          <button onClick={() => setShowingPeople(true)}>Who works here</button>
        </div>
      )}

      {(pinned('database') || showingMore) && <>
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
      </>}
    </div>
  );
}

function TabletSection({ status, onRevoke, onSetChamber, onPairingChamber }: {
  status: TabletStatus;
  onRevoke: (id: string) => void;
  onSetChamber: (deviceId: string, chamberId: string) => void;
  onPairingChamber: (chamberId: string) => void;
}) {
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
              {/* Which desk the next tablet is going to sit on. Decided
                  here rather than on the tablet: a tablet that could
                  choose its own chamber could choose the wrong one, and
                  its serial numbers would come out of the wrong
                  register all evening. */}
              {status.chambers.length > 1 && (
                <div className="field" style={{ maxWidth: 420 }}>
                  <label htmlFor="pairch">The next tablet paired sits at</label>
                  <select id="pairch" value={status.pairingChamberId ?? ''}
                    onChange={(e) => onPairingChamber(e.target.value)}>
                    {status.chambers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
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
              <thead><tr><th>Tablet</th><th>At which desk</th><th>Paired</th><th>Last seen</th><th /></tr></thead>
              <tbody>
                {status.devices.map((device) => (
                  <tr key={device.id}>
                    <td>{device.label}</td>
                    <td>
                      {status.chambers.length > 1 ? (
                        <select value={device.chamberId ?? ''}
                          style={{ margin: 0, padding: '4px 8px', fontSize: 13 }}
                          onChange={(e) => onSetChamber(device.id, e.target.value)}>
                          {status.chambers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : (device.chamberName ?? <span className="warn">not set</span>)}
                    </td>
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


/**
 * Backups, on the main screen rather than hidden in a settings page.
 *
 * A backup taken three months ago is a backup that has already failed,
 * so the thing this card is really for is the DATE. It goes amber
 * after three days and red after seven, and it is on the screen the
 * doctor opens every evening.
 */
function BackupCard(
  { status, note, canGiveCopies, onBackup, onCheck, onGiveCopy }: {
    status: BackupStatus | null; note: string | null; canGiveCopies: boolean;
    onBackup: () => void; onCheck: () => void; onGiveCopy: () => void;
  },
) {
  const urgency = status?.urgency ?? 'never';
  const when = (): string => {
    if (status === null) return 'reading…';
    if (status.lastBackupAt === null) return 'This has never been backed up.';
    const days = status.daysSince ?? 0;
    const ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    return status.lastBackupOk
      ? `Last backed up ${ago}, on ${status.lastBackupAt.slice(0, 10)}.`
      : `The last attempt, ${ago}, could not be read back. There is no backup you can rely on.`;
  };

  return (
    <div className={`card backup ${urgency}`}>
      <h2 style={{ marginTop: 0 }}>Backups</h2>
      <p className="backup-when">{when()}</p>
      <p>
        Everything this chamber knows about its patients is on this one laptop. A backup goes on a
        USB stick, and it is opened and checked before the program says it worked — a copy nobody
        has ever read is not a backup. Keep the stick somewhere the laptop is not: it holds the
        same records and the same locked-up key.
      </p>
      {note !== null && <p className="backup-note">{note}</p>}
      <button onClick={onBackup}>Back up now</button>
      <button className="secondary" style={{ marginLeft: 8 }} onClick={onCheck}>Check a backup</button>
      {canGiveCopies && (
        <button className="secondary" style={{ marginLeft: 8 }} onClick={onGiveCopy}>
          Give a patient their copy
        </button>
      )}
    </div>
  );
}
