import { useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';

/**
 * First run. Two steps: choose a password, then write down the recovery
 * key. The second step cannot be skipped, and that is deliberate - this
 * is the only moment the recovery key exists anywhere, and a chamber
 * that loses both the password and this sheet has lost every patient
 * record permanently.
 */
export function Setup({ onDone }: { onDone: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [stored, setStored] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = passphrase.length > 0 && passphrase.length < 8;
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const canCreate = passphrase.length >= 8 && confirm === passphrase && !busy;

  async function create() {
    setBusy(true);
    setFailure(null);
    const { value, failure } = unwrap(await api.create(passphrase, 'demo'));
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    setRecoveryKey(value!.recoveryKey);
  }

  if (recoveryKey !== null) {
    return (
      <div className="page">
        <h1>Write this down before you go any further</h1>
        <p className="subtitle">
          This is the only time this key will ever be shown. It is not stored anywhere you can read it.
        </p>
        <div className="card">
          <div className="recovery-key">{recoveryKey}</div>
          <p>
            If the password is ever forgotten, this key is the only way back into the patient
            records. If both are lost, the records cannot be recovered by anybody, including
            whoever wrote this software.
          </p>
          <p className="muted">
            Print it or copy it by hand, and keep it somewhere away from this laptop.
            The letters I, L, O and U are never used, so a 0 is always a zero and a 1 is always a one.
          </p>
          <div className="checkline">
            <input id="stored" type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} />
            <label htmlFor="stored">
              I have written down or printed this key and stored it somewhere other than this laptop.
            </label>
          </div>
          <button disabled={!stored} onClick={onDone}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Set up Chamber Recall</h1>
      <p className="subtitle">Choose the password that will open the patient records each evening.</p>
      {failure && <FailureNotice failure={failure} />}
      <div className="card">
        <label htmlFor="pp">Password</label>
        <input id="pp" type="password" value={passphrase} autoFocus
               onChange={(e) => setPassphrase(e.target.value)} />
        {tooShort && <p className="muted">Use at least 8 characters. A short phrase you will remember is better than a short complicated word.</p>}

        <div style={{ height: 16 }} />
        <label htmlFor="pp2">Type it again</label>
        <input id="pp2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <p className="muted">The two do not match yet.</p>}

        <button disabled={!canCreate} onClick={create}>
          {busy ? 'Creating the records file…' : 'Create the records file'}
        </button>
      </div>
    </div>
  );
}
