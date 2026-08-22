import { useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import type { MergePreview } from '../../shared/patients';

/**
 * Putting two records together.
 *
 * The screen is built for the mistake, not for the success. Merging two
 * records that really are one person is routine and harmless. Merging
 * two DIFFERENT people fuses two histories, and the doctor then reads
 * somebody else's blood pressure as if it were this patient's.
 *
 * So: both records are shown in full side by side, every disagreement
 * is marked, the direction is stated in words rather than implied by
 * which column something is in, and the whole thing can be undone
 * afterwards, putting back exactly the visits that moved.
 */
export function MergePatients(
  { firstId, secondId, onDone, onCancel }:
  { firstId: string; secondId: string; onDone: () => void; onCancel: () => void },
) {
  const [keepFirst, setKeepFirst] = useState(true);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const survivingId = keepFirst ? firstId : secondId;
  const duplicateId = keepFirst ? secondId : firstId;

  useEffect(() => {
    void (async () => {
      const { value, failure } = unwrap(await api.patientMergePreview(survivingId, duplicateId));
      if (failure) { setFailure(failure); return; }
      setFailure(null);
      setPreview(value!.preview);
    })();
  }, [survivingId, duplicateId]);

  async function doMerge() {
    setBusy(true);
    setFailure(null);
    const { failure } = unwrap(await api.patientMerge(survivingId, duplicateId, note.trim() === '' ? null : note.trim()));
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    onDone();
  }

  /**
   * Duplicate records very often share an identical Bangla name - that
   * is usually why they are duplicates. Naming only one script in the
   * summary then reads as "move X onto X", and the assistant cannot
   * tell which record is which. Both scripts are shown, and the phone
   * is added when even that is not enough to tell them apart.
   */
  const nameOf = (p: { nameBn: string | null; nameEn: string | null; phone: string | null }) => {
    const written = [p.nameBn, p.nameEn].filter((n) => n !== null && n.trim() !== '').join(' / ');
    const base = written === '' ? 'this record' : written;
    const sameOnBothSides = preview !== null
      && [preview.surviving.nameBn, preview.surviving.nameEn].join('|') === [preview.duplicate.nameBn, preview.duplicate.nameEn].join('|');
    return sameOnBothSides && p.phone !== null ? `${base} (${p.phone})` : base;
  };

  return (
    <div className="patients">
      <div className="patients-head">
        <h1>Are these the same person?</h1>
        <span className="spacer" />
        <button className="secondary" onClick={onCancel}>Back to search</button>
      </div>

      {failure !== null && <FailureNotice failure={failure} />}
      {preview === null ? <p className="muted">Reading both records…</p> : (
        <div style={{ overflowY: 'auto' }}>
          {preview.blockers.length > 0 && (
            <div className="merge-warning">
              <b>These two cannot be merged.</b>
              <ul>{preview.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          )}

          <div className="merge-grid">
            <div className="hdr lbl" />
            <div className="hdr">{keepFirst ? 'KEEP THIS ONE' : 'fold this one in'}</div>
            <div className="hdr">{keepFirst ? 'fold this one in' : 'KEEP THIS ONE'}</div>

            {preview.comparison.map((row) => (
              <Row key={row.field} label={row.label}
                   a={keepFirst ? row.surviving : row.duplicate}
                   b={keepFirst ? row.duplicate : row.surviving}
                   differs={row.differs} />
            ))}
            <Row label="Visits on record"
                 a={String(keepFirst ? preview.surviving.visitCount : preview.duplicate.visitCount)}
                 b={String(keepFirst ? preview.duplicate.visitCount : preview.surviving.visitCount)}
                 differs={false} />
            <Row label="Last seen"
                 a={(keepFirst ? preview.surviving : preview.duplicate).lastVisitDate}
                 b={(keepFirst ? preview.duplicate : preview.surviving).lastVisitDate}
                 differs={false} />
          </div>

          <p className="muted" style={{ marginTop: 8 }}>
            Rows shaded amber are where the two records disagree. Look at those before deciding —
            a different age or a different sex usually means these are two different people.
          </p>

          <button className="secondary" onClick={() => setKeepFirst((k) => !k)} disabled={busy}>
            Swap: keep the other one instead
          </button>

          <div className="merge-summary">
            <b>{preview.visitsToMove}</b> visit{preview.visitsToMove === 1 ? '' : 's'}
            {preview.attachmentsToMove > 0 && <> and <b>{preview.attachmentsToMove}</b> attachment{preview.attachmentsToMove === 1 ? '' : 's'}</>}
            {' '}will move onto <b>{nameOf(preview.surviving)}</b>.
            <br />
            Nothing is deleted. <b>{nameOf(preview.duplicate)}</b> stays in the system, marked as merged,
            and can still be found by its own name and phone number — so a patient who gives that old
            number is still found.
            <br />
            This can be undone afterwards, putting back exactly the visits that moved.
          </div>

          <div className="field" style={{ maxWidth: 620 }}>
            <label htmlFor="note">Why are these the same person? (optional, kept in the record)</label>
            <input id="note" value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="same man, registered twice with different spellings" />
          </div>

          <button onClick={doMerge} disabled={busy || preview.blockers.length > 0}>
            {busy ? 'Merging…' : `Yes — merge into ${nameOf(preview.surviving)}`}
          </button>
          <button className="secondary" onClick={onCancel} disabled={busy} style={{ marginLeft: 10 }}>
            No, these are different people
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, a, b, differs }: { label: string; a: string | null; b: string | null; differs: boolean }) {
  return (
    <>
      <div className="lbl">{label}</div>
      <div className={differs ? 'differs' : ''}>{a ?? <span className="muted">—</span>}</div>
      <div className={differs ? 'differs' : ''}>{b ?? <span className="muted">—</span>}</div>
    </>
  );
}
