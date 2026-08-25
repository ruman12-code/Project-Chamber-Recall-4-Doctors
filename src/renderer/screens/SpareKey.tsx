import { useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { roleLabel, type Role } from '../../shared/roles';
import type { SparePerson } from '../../shared/ipc';

/**
 * What to do when somebody has forgotten their PIN.
 *
 * One screen, one button. There is no administrator to sign in as,
 * because anybody who can be signed in as can become the author of
 * something, and this credential must never appear beside a patient's
 * name. So: a key, a list of people, and a new PIN. Nothing else is
 * reachable from here - no patient, no queue, no register, no report.
 *
 * The key is re-checked in the main process on every call rather than
 * remembered here, so nothing on this screen is load-bearing.
 */
export function SpareKey({ onClose }: { onClose: () => void }) {
  const [spareKey, setSpareKey] = useState('');
  const [people, setPeople] = useState<SparePerson[] | null>(null);
  const [chosen, setChosen] = useState<SparePerson | null>(null);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState<{ displayName: string; using: string } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    const { value, failure } = unwrap(await api.spareKeyPeople(spareKey));
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    setPeople(value!.people);
  }

  async function reset() {
    if (chosen === null) return;
    setBusy(true);
    const { value, failure } = unwrap(await api.spareKeyReset(spareKey, chosen.id, pin));
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    setDone(value!);
    setChosen(null); setPin(''); setConfirm('');
  }

  if (done !== null) {
    return (
      <div className="page">
        <h1>{done.displayName} can sign in again</h1>
        <div className="card">
          <p>
            Their PIN is the one you just typed. Tell it to them, and ask them to change it to
            something only they know — the doctor's screen has a Change PIN button for that.
          </p>
          <p className="muted">
            This reset was done with the {done.using}, and it is written in the record. {done.displayName} will
            be told about it on their own screen the next time they sign in, and will keep being
            told until they say they knew.
          </p>
          <button onClick={onClose}>Back to sign in</button>
        </div>
      </div>
    );
  }

  if (people === null) {
    return (
      <div className="page">
        <h1>Somebody has forgotten their PIN</h1>
        <p className="subtitle">
          This needs one of two things, and neither of them is a password anybody uses day to day.
        </p>
        {failure !== null && <FailureNotice failure={failure} />}
        <div className="card">
          <p>
            <b>The recovery key</b> — the long line of letters printed when this program was first
            set up, kept somewhere away from this laptop. Or <b>the spare code</b>, if the doctor
            has set one for whoever helps him with the laptop.
          </p>
          <div className="field">
            <label htmlFor="sk">Recovery key or spare code</label>
            <input id="sk" type="password" autoFocus value={spareKey} autoComplete="off"
              onChange={(e) => setSpareKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void open(); }} />
          </div>
          <button disabled={busy || spareKey.trim() === ''} onClick={() => { void open(); }}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
          <button className="secondary" style={{ marginLeft: 8 }} onClick={onClose}>Go back</button>
        </div>
        <div className="card">
          <p className="muted">
            Nothing about a patient is reachable from this screen, whichever key is used. It shows
            the names of the people who work here and sets one of them a new PIN.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Whose PIN needs resetting?</h1>
      {failure !== null && <FailureNotice failure={failure} />}
      <div className="si-people">
        {people.map((person) => (
          <button key={person.id}
            className={chosen?.id === person.id ? 'si-person on' : 'si-person'}
            onClick={() => { setChosen(person); setPin(''); setConfirm(''); setFailure(null); }}>
            <span className="n">{person.displayName}</span>
            <span className="r">
              {roleLabel(person.role as Role).en} · {roleLabel(person.role as Role).bn}
              {!person.isActive && ' · switched off'}
              {!person.canSignIn && ' · no PIN yet'}
            </span>
          </button>
        ))}
      </div>

      {chosen !== null && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>A new PIN for {chosen.displayName}</h2>
          <div className="field">
            <label htmlFor="np">New PIN</label>
            <input id="np" type="password" inputMode="numeric" autoFocus value={pin}
              onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} />
          </div>
          <div className="field">
            <label htmlFor="np2">Type it again</label>
            <input id="np2" type="password" inputMode="numeric" value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/[^0-9]/g, ''))} />
          </div>
          {confirm.length > 0 && confirm !== pin && <p className="muted">The two do not match yet.</p>}
          <button disabled={busy || pin.length < 4 || pin !== confirm} onClick={() => { void reset(); }}>
            {busy ? 'Setting it…' : `Set ${chosen.displayName}'s PIN`}
          </button>
        </div>
      )}

      <div className="card">
        <button className="secondary" onClick={onClose}>Go back without changing anything</button>
      </div>
    </div>
  );
}
