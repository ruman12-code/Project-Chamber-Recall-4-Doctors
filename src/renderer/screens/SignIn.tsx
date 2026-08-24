import { useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { roleLabel, type Role } from '../../shared/roles';
import type { StaffView, PracticeSeedResult } from '../../shared/ipc';

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

  const refresh = async () => {
    const { value, failure } = unwrap(await api.staffList());
    if (failure) { setFailure(failure); return; }
    setPeople(value!.people);
  };
  useEffect(() => { void refresh(); }, []);

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
              <li key={p.id}>
                <b>{p.displayName}</b> — {roleLabel(p.role as Role).en}
                {!p.canSignIn && <span className="warn"> · no PIN yet, cannot sign in</span>}
                {!p.isActive && <span className="warn"> · switched off</span>}
              </li>
            ))}
          </ul>
        )}
        <button disabled={!hasDoctor} onClick={() => { void onDone(); }}>
          {hasDoctor ? 'Done — go to sign in' : 'A doctor is needed before this can be finished'}
        </button>
      </div>
    </div>
  );
}
