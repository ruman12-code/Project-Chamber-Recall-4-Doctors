import { useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import type { RedFlagAlertView } from '../../shared/ipc';

/**
 * What the assistant sees when a rule fires.
 *
 * Three things about this screen are deliberate:
 *
 *   It covers everything. There is no way back to the questions except
 *   the acknowledgement button, so it cannot be scrolled past or
 *   dismissed by accident while hurrying through a queue.
 *
 *   It says nothing about how serious anything is. No score, no level,
 *   no rating, no word like urgent or critical. The patient and whoever
 *   came with them can read this screen. They are told to see the
 *   doctor sooner, which is true and unfrightening; they are not shown
 *   a judgement about their condition.
 *
 *   Bangla comes first and larger. English is underneath for an
 *   assistant who prefers it. Neither is a translation shown on demand:
 *   both are always on screen, because there is no time to switch
 *   languages during the moment this screen exists for.
 */
export function RedFlagAlert({ alert, onAcknowledged }: { alert: RedFlagAlertView; onAcknowledged: () => void }) {
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  async function acknowledge() {
    setBusy(true);
    setFailure(null);
    const { failure } = unwrap(await api.redFlagAcknowledge(alert.eventId));
    setBusy(false);
    // If recording the acknowledgement failed, the screen stays. It
    // must never look acknowledged when nothing was written down.
    if (failure) { setFailure(failure); return; }
    onAcknowledged();
  }

  return (
    <div className="alarm-screen" role="alertdialog" aria-modal="true">
      <p className="instruction-bn">এখনই ডাক্তারকে জানান।<br />সিরিয়ালে অপেক্ষা করবেন না।</p>
      <p className="instruction-en">Tell the doctor now. Do not wait in the queue.</p>

      <div className="rule-message">
        <p>{alert.messageBn}</p>
        <p>{alert.messageEn}</p>
      </div>

      <p className="who">
        {alert.patientName ?? 'this patient'}
        {alert.serialNo !== null && <> · সিরিয়াল / serial {alert.serialNo}</>}
      </p>

      {failure !== null && (
        <div style={{ maxWidth: 820, textAlign: 'left', width: '100%' }}>
          <FailureNotice failure={failure} />
        </div>
      )}

      <button onClick={acknowledge} disabled={busy} autoFocus>
        {busy ? 'রেকর্ড হচ্ছে…' : 'আমি ডাক্তারকে জানিয়েছি / I have told the doctor'}
      </button>

      <p className="reference">{alert.ruleId} · version {alert.ruleVersion}</p>
    </div>
  );
}
