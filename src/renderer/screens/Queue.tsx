import { useCallback, useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { PatientSearch } from './PatientSearch';
import type { QueueEntry, QueueView } from '../../shared/queue';

/**
 * The serial register and the live queue.
 *
 * This replaces a paper book, and it has to beat the book at the book's
 * own job before anything else in this software matters. So the serial
 * number is the largest thing on every row - it is what gets called out
 * across a waiting room - and adding an arrival is two taps from here.
 *
 * It works entirely on its own. Nobody has to answer a single intake
 * question for this screen to be worth using, and a patient with no
 * intake is shown plainly as not screened rather than silently looking
 * the same as somebody the questions cleared.
 *
 * Reordering is by buttons and by keyboard rather than by dragging.
 * Dragging on a touch screen misfires, and a misfire here silently
 * changes who the doctor sees next.
 */
export function Queue({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<QueueView | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(0);
  const [justAdded, setJustAdded] = useState<{ serialNo: number; name: string } | null>(null);

  const refresh = useCallback(async () => {
    const { value, failure } = unwrap(await api.queueToday());
    if (failure) { setFailure(failure); return; }
    setView(value!.view);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Waiting times are the point of a live queue, so they keep counting
  // without anybody touching the screen.
  useEffect(() => {
    const timer = setInterval(() => { void refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function act<T extends object>(promise: Promise<import('../../shared/ipc').Result<T>>) {
    const { failure } = unwrap(await promise);
    if (failure) { setFailure(failure); return false; }
    setFailure(null);
    await refresh();
    return true;
  }

  async function addPatient(patientId: string) {
    const { value, failure } = unwrap(await api.queueRegisterArrival(patientId, false));
    if (failure) { setFailure(failure); setAdding(false); return; }
    if (value!.alreadyOnListVisitId !== null) {
      const confirmed = window.confirm(
        'This patient is already on today\'s list.\n\nAdd them a second time anyway? Only do this if they really have come back a second time this evening.',
      );
      if (!confirmed) { setAdding(false); await refresh(); return; }
      const second = unwrap(await api.queueRegisterArrival(patientId, true));
      if (second.failure) { setFailure(second.failure); setAdding(false); return; }
      setJustAdded({ serialNo: second.value!.serialNo, name: '' });
    } else {
      setJustAdded({ serialNo: value!.serialNo, name: '' });
    }
    setAdding(false);
    await refresh();
  }

  if (adding) {
    return <PatientSearch
      onClose={() => setAdding(false)}
      onPick={(patient) => { void addPatient(patient.id); }}
      pickLabel="Give a serial" />;
  }

  // The failure check comes BEFORE the loading check, always. With them
  // the other way round - which is how this was first written - an error
  // on the very first load leaves the screen saying "Reading today's
  // list" for ever with the error rendered nowhere, which is the exact
  // silent failure this project treats as the worst possible outcome.
  if (failure !== null && view === null) {
    return <div className="page"><FailureNotice failure={failure} /></div>;
  }
  if (view === null) return <div className="page"><p className="muted">Reading today's list…</p></div>;

  const entries = view.entries;
  const count = (status: QueueEntry['status']) => entries.filter((e) => e.status === status).length;
  const waitingIds = entries.filter((e) => e.status === 'waiting').map((e) => e.visitId);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((i) => Math.min(i + 1, entries.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((i) => Math.max(i - 1, 0)); }
    else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.altKey) { /* handled below */ }
    else if (event.key === 'Escape') { onClose(); }
  }

  function onKeyDownCapture(event: React.KeyboardEvent) {
    const entry = entries[selected];
    if (entry === undefined) return;
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      void act(api.queueMove(entry.visitId, event.key === 'ArrowUp' ? 'up' : 'down'));
    } else if (event.key === 'Enter' && entry.status === 'waiting') {
      event.preventDefault();
      void act(api.queueSetStatus(entry.visitId, 'in_chamber'));
    }
  }

  return (
    <div className="queue" tabIndex={0} onKeyDown={onKeyDown} onKeyDownCapture={onKeyDownCapture}>
      {/* The heading for paper. On screen the chamber is in the picker
          above; on paper it has to say which chamber and which day, at
          the top, because the sheet outlives the screen. */}
      <div className="print-only print-head">
        {view.chamberName} — {view.visitDate}
      </div>

      <div className="queue-head">
        <h1>Today's list</h1>
        <select
          value={view.chamberId ?? ''}
          onChange={(e) => { void act(api.queueSetChamber(e.target.value)); }}
          aria-label="Which chamber"
        >
          {view.chambers.map((chamber) => <option key={chamber.id} value={chamber.id}>{chamber.name}</option>)}
        </select>
        <span className="muted">{view.visitDate}</span>

        <div className="queue-counts">
          <div className="c"><b>{count('waiting')}</b>waiting</div>
          <div className="c"><b>{count('in_chamber')}</b>with the doctor</div>
          <div className="c"><b>{count('done')}</b>seen</div>
        </div>

        <span className="spacer" />
        <button onClick={() => { setJustAdded(null); setAdding(true); }}>Patient has arrived</button>
        <button className="secondary" onClick={() => window.print()}>Print this list</button>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>

      {justAdded !== null && (
        <div className="banner" style={{ marginBottom: 0 }}>
          Serial {justAdded.serialNo} given. Tell the patient their number.
        </div>
      )}

      {failure !== null && <FailureNotice failure={failure} />}

      <div className="queue-list">
        {entries.length === 0 ? (
          <div className="queue-empty">
            <b>Nobody on the list yet</b>
            Tap "Patient has arrived" when the first patient comes in.
          </div>
        ) : entries.map((entry, index) => (
          <Row
            key={entry.visitId}
            entry={entry}
            selected={index === selected}
            canMoveUp={waitingIds.indexOf(entry.visitId) > 0}
            canMoveDown={waitingIds.indexOf(entry.visitId) >= 0 && waitingIds.indexOf(entry.visitId) < waitingIds.length - 1}
            onSelect={() => setSelected(index)}
            onMove={(direction) => { void act(api.queueMove(entry.visitId, direction)); }}
            onStatus={(status) => {
          // A patient the questions flagged cannot be taken off the
          // list by one careless tap. The software cannot stop somebody
          // walking out, but it can make sure nobody does it by
          // accident, and it records that it happened either way.
          if (status === 'left' && entry.redFlags.length > 0) {
            const sure = window.confirm(
              'This patient was flagged to be seen sooner.\n\nMark them as having left without seeing the doctor?\n\nOnly do this if they have actually gone. It will be recorded.',
            );
            if (!sure) return;
          }
          void act(api.queueSetStatus(entry.visitId, status));
        }}
          />
        ))}
      </div>

      <p className="queue-foot no-print">
        Arrow keys move down the list · Alt and an arrow moves a patient up or down the order ·
        Enter calls the highlighted patient in. Serial numbers never change when the order does.
      </p>
    </div>
  );
}

function Row(
  { entry, selected, canMoveUp, canMoveDown, onSelect, onMove, onStatus }: {
    entry: QueueEntry; selected: boolean; canMoveUp: boolean; canMoveDown: boolean;
    onSelect: () => void; onMove: (d: 'up' | 'down') => void; onStatus: (s: QueueEntry['status']) => void;
  },
) {
  const flagged = entry.redFlags.length > 0;
  const name = entry.nameBn ?? entry.nameEn ?? 'unnamed';
  const altName = entry.nameBn !== null && entry.nameEn !== null ? entry.nameEn : null;

  return (
    <div
      className={`qrow ${entry.status} ${flagged ? 'flagged' : ''} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <div className="serial"><small>serial</small>{entry.serialNo}</div>

      <div className="who">
        <div className="n">{name}{altName !== null && <span className="alt">{altName}</span>}</div>
        <div className="tags">
          {flagged && <span className="qtag flag">SEE SOONER</span>}
          {!entry.intakeStarted && <span className="qtag gap">not screened</span>}
          {entry.intakeStarted && entry.screeningIncomplete && <span className="qtag gap">screening incomplete</span>}
          {entry.previousVisits === 0
            ? <span className="qtag new">first visit</span>
            : <span className="qtag back">{entry.previousVisits} previous · last {entry.lastVisitDate}</span>}
        </div>
      </div>

      <div className="cell">
        {entry.ageYears === null ? <span className="muted">age not known</span>
          : `${entry.ageYears}${entry.ageIsApproximate ? ' approx' : ''}`}
        <div className="muted">{entry.sex ?? '—'}</div>
      </div>

      <div className={`waited ${entry.waitedMinutes >= 45 && entry.status === 'waiting' ? 'long' : ''}`}>
        {entry.waitedMinutes}<small>{entry.status === 'waiting' ? 'min waiting' : 'min waited'}</small>
      </div>

      <div className="nudge no-print">
        {entry.status === 'waiting' && (
          <>
            <button className="secondary" disabled={!canMoveUp} onClick={(e) => { e.stopPropagation(); onMove('up'); }} aria-label="Move up">▲</button>
            <button className="secondary" disabled={!canMoveDown} onClick={(e) => { e.stopPropagation(); onMove('down'); }} aria-label="Move down">▼</button>
          </>
        )}
      </div>

      <div className="acts no-print">
        {entry.status === 'waiting' && (
          <>
            <button onClick={(e) => { e.stopPropagation(); onStatus('in_chamber'); }}>Call in</button>
            <button className="secondary" onClick={(e) => { e.stopPropagation(); onStatus('left'); }}>Left</button>
          </>
        )}
        {entry.status === 'in_chamber' && (
          <>
            <button onClick={(e) => { e.stopPropagation(); onStatus('done'); }}>Seen</button>
            <button className="secondary" onClick={(e) => { e.stopPropagation(); onStatus('waiting'); }}>Back to waiting</button>
          </>
        )}
        {entry.status === 'done' && (
          <button className="secondary" onClick={(e) => { e.stopPropagation(); onStatus('in_chamber'); }}>Undo</button>
        )}
        {entry.status === 'left' && (
          <button className="secondary" onClick={(e) => { e.stopPropagation(); onStatus('waiting'); }}>Came back</button>
        )}
      </div>
    </div>
  );
}
