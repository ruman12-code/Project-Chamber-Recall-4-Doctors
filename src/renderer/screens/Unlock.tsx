import { useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';

export function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    setFailure(null);
    const { failure } = unwrap(await api.unlock(passphrase));
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    onUnlocked();
  }

  return (
    <div className="page">
      <h1>Chamber Recall</h1>
      <p className="subtitle">Enter the password to open the patient records.</p>
      {failure && <FailureNotice failure={failure} />}
      <div className="card">
        <label htmlFor="pp">Password</label>
        <input id="pp" type="password" value={passphrase} autoFocus
               onChange={(e) => setPassphrase(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && passphrase.length > 0 && !busy) void unlock(); }} />
        <button disabled={passphrase.length === 0 || busy} onClick={unlock}>
          {busy ? 'Opening…' : 'Open records'}
        </button>
      </div>
    </div>
  );
}
