import { useState } from 'react';
import { api, storeToken } from '../api';

/**
 * Done once, when the tablet is first set up. The laptop shows a short
 * code; it is typed in here; the tablet remembers a long one from then
 * on. Without this, anything else on the chamber's wifi could read the
 * waiting list and every answer given at the desk.
 */
export function Pair({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<{ error: string; whatToDo: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.pair(code, 'front desk tablet');
      storeToken(token);
      onPaired();
    } catch (caught) {
      const e = caught as Error & { whatToDo?: string };
      setError({ error: e.message, whatToDo: e.whatToDo ?? 'Check the code on the laptop and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="pair">
        <h1>ট্যাবলেট যুক্ত করুন</h1>
        <p className="prompt en" style={{ marginTop: 0 }}>Connect this tablet to the laptop</p>
        <p>ল্যাপটপের পর্দায় যে কোডটি দেখাচ্ছে সেটি লিখুন।<br />
          <span style={{ color: 'var(--muted)', fontSize: 16 }}>Type the code shown on the laptop screen.</span></p>

        {error !== null && (
          <div className="notice bad" style={{ marginBottom: 16 }}>
            <div className="t">{error.error}</div>
            <div className="d">{error.whatToDo}</div>
          </div>
        )}

        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXX-XXX"
          autoFocus
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
        />
        <div className="footbar" style={{ marginTop: 16 }}>
          <button className="btn wide" disabled={code.trim().length < 4 || busy} onClick={submit}>
            {busy ? 'যুক্ত হচ্ছে…' : 'যুক্ত করুন / Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
