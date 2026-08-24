import { useCallback, useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { KIND_LABEL, type AttachmentView, type AttachmentKind } from '../../shared/attachments';

/**
 * The papers a patient brought, as photographed at the desk.
 *
 * A list down the side and one picture filling the rest of the screen.
 * There are no thumbnails, deliberately: making them would mean
 * storing a second copy of every photograph, and loading forty full
 * pictures to draw a grid would make the screen crawl on the laptop
 * this runs on. The list carries what actually distinguishes one sheet
 * from another - what kind of paper it is, the date, and who filed it.
 *
 * The software never reads what is in these pictures. Nothing is
 * recognised, extracted or classified. It is a photograph of a piece
 * of paper, filed under a heading a person chose.
 */
export function Attachments(
  { patientId, visitId, patientName, onClose }: {
    patientId: string; visitId: string | null; patientName: string; onClose: () => void;
  },
) {
  const [list, setList] = useState<AttachmentView[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [image, setImage] = useState<{ id: string; dataUrl: string } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [imageFailure, setImageFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<AttachmentKind>('report');

  const refresh = useCallback(async () => {
    const { value, failure } = unwrap(await api.attachmentsFor(patientId));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    setList(value!.attachments);
    setSelected((current) => current ?? value!.attachments[0]?.id ?? null);
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The picture itself is fetched only for the one being looked at.
  useEffect(() => {
    if (selected === null) { setImage(null); return; }
    if (image?.id === selected) return;
    void (async () => {
      const { value, failure } = unwrap(await api.attachmentContent(selected));
      if (failure) { setImageFailure(failure); setImage(null); return; }
      setImageFailure(null);
      setImage({ id: selected, dataUrl: value!.dataUrl });
    })();
  }, [selected, image]);

  async function add() {
    setBusy(true);
    const { value, failure } = unwrap(await api.attachmentAdd(patientId, visitId, kind, null));
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    if (value!.added > 0) await refresh();
  }

  async function remove(attachment: AttachmentView) {
    const reason = window.prompt(
      'Why is this photograph being taken off the record?\n\nOne sentence — "wrong patient", "unreadable". It stays with the record.',
    );
    if (reason === null || reason.trim() === '') return;
    const { failure } = unwrap(await api.attachmentRemove(attachment.id, reason));
    if (failure) { setFailure(failure); return; }
    setSelected(null);
    setImage(null);
    await refresh();
  }

  if (failure !== null && list === null) {
    return (
      <div className="page">
        <FailureNotice failure={failure} />
        <button onClick={onClose}>Go back</button>
      </div>
    );
  }

  const current = list?.find((a) => a.id === selected) ?? null;

  return (
    <div className="att">
      <div className="att-head">
        <span className="name">{patientName}</span>
        <span className="facts">
          {list === null ? 'reading…' : `${list.length} photograph${list.length === 1 ? '' : 's'} on the record`}
        </span>
        <span className="right">
          <select value={kind} aria-label="What kind of paper" onChange={(e) => setKind(e.target.value as AttachmentKind)}>
            {(Object.keys(KIND_LABEL) as AttachmentKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k].en}</option>
            ))}
          </select>
          <button disabled={busy} onClick={() => { void add(); }}>Add from this laptop</button>
          <button className="secondary" onClick={onClose}>Close</button>
        </span>
      </div>

      {failure !== null && <FailureNotice failure={failure} />}

      <div className="att-body">
        <div className="att-list">
          {list !== null && list.length === 0 && (
            <p className="muted">
              Nothing has been photographed for this patient yet. The front desk can photograph
              reports and old prescriptions on the tablet while taking the history.
            </p>
          )}
          {(list ?? []).map((attachment) => (
            <button
              key={attachment.id}
              className={attachment.id === selected ? 'att-row on' : 'att-row'}
              onClick={() => setSelected(attachment.id)}
            >
              <span className="k">{KIND_LABEL[attachment.kind].en}</span>
              <span className="d">
                {attachment.documentDate ?? attachment.capturedAt.slice(0, 10)}
                {attachment.documentDate !== null && <span className="dim"> on the paper</span>}
              </span>
              <span className="w">
                {attachment.addedByName ?? 'unknown'} · {attachment.source}
                {' · '}{Math.round(attachment.byteSize / 1024)} KB
              </span>
              {attachment.caption !== null && <span className="c">{attachment.caption}</span>}
            </button>
          ))}
        </div>

        <div className="att-view">
          {imageFailure !== null && <FailureNotice failure={imageFailure} />}
          {imageFailure === null && image === null && selected !== null && <p className="muted">Opening…</p>}
          {imageFailure === null && image !== null && (
            <img src={image.dataUrl} alt={current === null ? '' : KIND_LABEL[current.kind].en} />
          )}
          {current !== null && (
            <div className="att-actions">
              <span className="muted">
                Photographed {new Date(current.capturedAt).toLocaleString()}
                {current.visitDate !== null && ` · at the visit on ${current.visitDate}`}
              </span>
              <button className="secondary" onClick={() => { void remove(current); }}>
                Take off the record
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
