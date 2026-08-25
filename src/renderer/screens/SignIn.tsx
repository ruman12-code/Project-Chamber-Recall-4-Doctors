import { useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { SpareKey } from './SpareKey';
import { roleLabel, type Role } from '../../shared/roles';
import type { StaffView, PracticeSeedResult, SpareKeyStatus } from '../../shared/ipc';

/**
 * Signing in.
 *
 * Three or four people work here and they all know each other, so
 * there is no username to type: the names are on the screen, you tap
 * yours and type four digits. That is not a compromise for
 * convenience, it is the design - a sign-in that takes ten seconds at
 * a busy desk is a sign-in that gets shared.
 *
 * What it is for is stated on the screen, because a person asked to
 * type a PIN twenty times an evening deserves to know why: everything
 * written in this program carries the name of whoever wrote it, and
 * that is part of a medical record.
 */
export function SignIn({ onSignedIn, demo }: { onSignedIn: () => Promise<void>; demo: boolean }) {
  const [forgotten, setForgotten] = useState(false);
  const [people, setPeople] = useState<StaffView[] | null>(null);
  const [chosen, setChosen] = useState<StaffView | null>(null);
  const [pin, setPin] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { value, failure } = unwrap(await api.signInList());
      if (failure) { setFailure(failure); return; }
      setPeople(value!.people);
    })();
  }, []);

  async function go() {
    if (chosen === null || pin === '') return;
    setBusy(true);
    const { failure } = unwrap(await api.signIn(chosen.id, pin));
    setBusy(false);
    setPin('');
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    await onSignedIn();
  }

  if (failure !== null && people === null) {
    return <div className="page"><FailureNotice failure={failure} /></div>;
  }
  if (people === null) return <div className="page"><p className="muted">Reading…</p></div>;
  if (forgotten) return <SpareKey onClose={() => setForgotten(false)} />;

  return (
    <div className="signin">
      {/* Which database this is, before anybody starts working in it
          rather than after. Finding out on the next screen is finding
          out too late. */}
      {demo && (
        <div className="banner">
          PRACTICE DATABASE — the people in here are invented. Never enter a real patient.
        </div>
      )}
      <h1>Who is using this?</h1>
      <p className="subtitle">
        Everything written here — a history, a blood pressure, a prescription — is recorded against
        the person who wrote it, because that is part of a patient's record. So the program has to
        know which of you is at the keyboard.
      </p>

      {failure !== null && <FailureNotice failure={failure} />}

      <div className="si-people">
        {people.map((person) => (
          <button
            key={person.id}
            className={chosen?.id === person.id ? 'si-person on' : 'si-person'}
            onClick={() => { setChosen(person); setPin(''); setFailure(null); }}
          >
            <span className="n">{person.displayName}</span>
            <span className="r">{roleLabel(person.role as Role).en} · {roleLabel(person.role as Role).bn}</span>
            {/* Only ever present in a practice database. Shown because
                an invented person's PIN is not a secret, and being
                locked out of a database full of invented people helps
                nobody. */}
            {person.practicePin != null && (
              <span className="pin">PIN {person.practicePin}</span>
            )}
          </button>
        ))}
      </div>

      {chosen !== null && (
        <div className="si-pin">
          <label htmlFor="pin">{chosen.displayName}, type your PIN</label>
          <input
            id="pin" type="password" inputMode="numeric" autoFocus value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') void go(); }}
          />
          <button disabled={busy || pin.length < 4} onClick={() => { void go(); }}>Sign in</button>
        </div>
      )}

      {/* Quiet, and at the bottom, because it is not part of an ordinary
          evening. But present, because the alternative is a chamber that
          cannot open its own records. */}
      <div className="si-forgotten">
        <button className="linkish" onClick={() => setForgotten(true)}>
          Forgotten your PIN? · পিন ভুলে গেছেন?
        </button>
      </div>
    </div>
  );
}

/**
 * The setup screen, shown once on a new installation and never again.
 *
 * The program will not record anything clinical until at least one
 * doctor exists here, because a record with no author cannot be
 * repaired afterwards - there is nothing to look the answer up from.
 */
export function SetUpPeople({ onDone, demo }: { onDone: () => Promise<void>; demo: boolean }) {
  const [people, setPeople] = useState<StaffView[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('doctor');
  const [pin, setPin] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [filling, setFilling] = useState(false);
  const [practice, setPractice] = useState<PracticeSeedResult | null>(null);
  const [changing, setChanging] = useState<StaffView | null>(null);
  const [newPin, setNewPin] = useState('');
  const [spare, setSpare] = useState<SpareKeyStatus | null>(null);
  const [spareCode, setSpareCode] = useState('');

  const refresh = async () => {
    const { value, failure } = unwrap(await api.staffList());
    if (failure) { setFailure(failure); return; }
    setPeople(value!.people);
  };
  const readSpare = async () => {
    const { value, failure } = unwrap(await api.spareKeyStatus());
    if (failure) { setFailure(failure); return; }
    setSpare(value!.status);
  };
  useEffect(() => { void refresh(); void readSpare(); }, []);

  async function add() {
    const { failure } = unwrap(await api.staffAdd(name.trim(), role, pin));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    setName(''); setPin('');
    await refresh();
  }

  /**
   * Fill this practice database with invented patients, so the program
   * can be shown to somebody with four years of history behind it.
   * Offered only on a practice database that is still empty; there is
   * no version of this button on a real one.
   */
  async function fillWithPractice() {
    setFilling(true);
    setFailure(null);
    const { value, failure } = unwrap(await api.seedPractice());
    setFilling(false);
    if (failure) { setFailure(failure); return; }
    setPractice(value!);
    await refresh();
  }

  async function changePin() {
    if (changing === null) return;
    const { failure } = unwrap(await api.staffSetPin(changing.id, newPin));
    if (failure) { setFailure(failure); return; }
    setFailure(null); setChanging(null); setNewPin('');
    await refresh();
  }

  async function setActive(person: StaffView, active: boolean) {
    const { failure } = unwrap(await api.staffSetActive(person.id, active));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    await refresh();
  }

  async function saveSpareCode() {
    const { failure } = unwrap(await api.spareKeySetCode(spareCode));
    if (failure) { setFailure(failure); return; }
    setFailure(null); setSpareCode('');
    await readSpare();
  }

  async function dropSpareCode() {
    const { failure } = unwrap(await api.spareKeyClearCode());
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    await readSpare();
  }

  const hasDoctor = people.some((p) => p.role === 'doctor' && p.canSignIn && p.isActive);

  return (
    <div className="page">
      {demo && (
        <div className="banner">
          PRACTICE DATABASE — the people in here are invented. Never enter a real patient.
        </div>
      )}
      <h1>Who works here</h1>
      <p className="subtitle">
        Add the doctor and everyone who will use this program. Each person gets a PIN of their own —
        four to eight digits, not written down anywhere, and not shared. Nothing clinical can be
        recorded until at least the doctor is here.
      </p>

      {failure !== null && <FailureNotice failure={failure} />}

      {demo && people.length === 0 && practice === null && (
        <div className="card practice-offer">
          <h2 style={{ marginTop: 0 }}>Or fill it with practice patients</h2>
          <p>
            Before adding anybody real, this practice database can be filled with 300 invented
            patients and four years of invented visits — enough that a Recall Card has something
            on it and today's list has people waiting. It is the only honest way to show somebody
            what an evening looks like.
          </p>
          <p className="muted">
            Nobody in it exists. It takes a few seconds, and it can only ever be done once, on a
            practice database that is still empty.
          </p>
          <button className="secondary" disabled={filling} onClick={() => { void fillWithPractice(); }}>
            {filling ? 'Inventing patients and their histories…' : 'Fill this practice database'}
          </button>
        </div>
      )}

      {practice !== null && (
        <div className="card practice-offer">
          <h2 style={{ marginTop: 0 }}>The practice database is ready</h2>
          <p>
            {practice.patients} invented patients, {practice.visits} visits and {practice.encounters}{' '}
            consultations, written in {practice.seconds} seconds. {practice.redFlagsFired} of those
            intakes tripped a rule and were moved up the queue.
          </p>
          <p>Sign in as one of these to look around:</p>
          <ul className="staff-list">
            {practice.signIns.map((p) => (
              <li key={p.pin}><b>{p.name}</b> — PIN {p.pin}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add somebody</h2>
        <div className="field">
          <label htmlFor="sname">Their name, as the doctor would say it</label>
          <input id="sname" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="srole">What they do</label>
          <select id="srole" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="doctor">Doctor — sees patients, confirms the record</option>
            <option value="clinical_assistant">Clinical assistant — types while the doctor speaks</option>
            <option value="front_desk">Front desk — serials, arrivals, the history at the desk</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="spin">Their PIN</label>
          <input id="spin" type="text" inputMode="numeric" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <button disabled={name.trim() === '' || pin.length < 4} onClick={() => { void add(); }}>Add</button>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Here so far</h2>
        {people.length === 0 ? <p className="muted">Nobody yet.</p> : (
          <ul className="staff-list">
            {people.map((p) => (
              <li key={p.id} className="staff-row">
                <span className="who">
                  <b>{p.displayName}</b> — {roleLabel(p.role as Role).en}
                  {!p.canSignIn && <span className="warn"> · no PIN yet, cannot sign in</span>}
                  {!p.isActive && <span className="warn"> · switched off</span>}
                </span>
                <span className="acts">
                  <button className="secondary" onClick={() => { setChanging(p); setNewPin(''); }}>
                    Change PIN
                  </button>
                  <button className="secondary" onClick={() => { void setActive(p, !p.isActive); }}>
                    {p.isActive ? 'Retire' : 'Bring back'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Nobody is ever removed. Retiring stops them signing in and
            leaves every record they wrote exactly as it was, with their
            name still on it, because a medical record does not lose its
            author when somebody leaves. */}
        {changing !== null && (
          <div className="restate">
            <b>A new PIN for {changing.displayName}</b>
            <div className="field">
              <label htmlFor="chpin">Four to eight digits</label>
              <input id="chpin" type="password" inputMode="numeric" autoFocus value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') void changePin(); }} />
            </div>
            <button disabled={newPin.length < 4} onClick={() => { void changePin(); }}>Set it</button>
            <button className="secondary" style={{ marginLeft: 8 }}
              onClick={() => { setChanging(null); setNewPin(''); }}>Cancel</button>
          </div>
        )}
        <button disabled={!hasDoctor} onClick={() => { void onDone(); }}>
          {hasDoctor ? 'Done — go to sign in' : 'A doctor is needed before this can be finished'}
        </button>
      </div>

      {/* The spare key. Optional, because the recovery key already
          works and needs no setting up - this exists so the recovery
          key can stay in its envelope. */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>If somebody forgets their PIN</h2>
        <p>
          Anybody holding the <b>recovery key</b> — the long line of letters printed when this was
          set up — can already set a new PIN, from the "Forgotten your PIN?" line on the sign-in
          screen. That works today and needs nothing from you.
        </p>
        <p>
          You can also set a <b>spare code</b> for whoever helps you with the laptop, so the
          recovery key can stay where it is. It opens the same one screen: a list of names and a
          new PIN. It reaches no patient, no list and no report.
        </p>
        {spare?.codeIsSet === true ? (
          <>
            <p className="muted">A spare code is set{spare.codeSetAt !== null && ` (${spare.codeSetAt.slice(0, 10)})`}.</p>
            <button className="secondary" onClick={() => { void dropSpareCode(); }}>Remove the spare code</button>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="spc">A spare code, at least eight characters</label>
              <input id="spc" type="text" value={spareCode} autoComplete="off"
                onChange={(e) => setSpareCode(e.target.value)} />
            </div>
            <button disabled={spareCode.trim().length < 8} onClick={() => { void saveSpareCode(); }}>
              Set the spare code
            </button>
          </>
        )}
        <p className="muted">
          Whichever key is used, the reset is written into the record and the person it happened to
          is told on their own screen until they say they knew about it.
        </p>
      </div>
    </div>
  );
}
